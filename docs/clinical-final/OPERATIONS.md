# HMS operations: downtime, incidents, support and staff rehearsal

Completion package **C6**. Status: **DRAFT — awaiting owner review.** The
software steps below are exercised by automated drills (`e2e/downtimeDrill.e2e.js`,
`e2e/downtime.e2e.js`). Staff rehearsals, named contacts and the hospital's
sign-off are hospital inputs. They are left blank here, never assumed.

Plain rule for everyone: **if HMS is down or wrong, patient care continues on
paper. Nothing is lost if you write it down with the real time.**

---

## 1. Who does what

Fill in before go-live. One person per row per shift, with a named backup.

| Role | Responsibility | Name / phone (day) | Name / phone (night) |
|---|---|---|---|
| Downtime lead (senior nurse or duty manager) | Declares and ends downtime; hands out paper kits; owns return to service | | |
| IT on call | Restores HMS; runs the checks in §6 | | |
| Clinical lead (doctor) | Clinical decisions while records are on paper; signs off reconciliation | | |
| Pharmacy lead | Dispensing on paper; stock reconciliation afterwards | | |
| Laboratory lead | Specimen labels and results on paper; critical results by phone | | |
| Data protection officer | Lost kit keys, suspected breaches, patient-record errors | | |
| HMS vendor support | Software defects (contact and hours from the support agreement) | | |

---

## 2. The downtime kit: getting it onto ward machines

The kit is a read-only summary of every admitted patient: identifiers, bed,
allergy status, active medicines with doses due, problems and open critical
results. HMS remakes it every 15 minutes (`DOWNTIME_REFRESH_MINUTES`). The
kit is encrypted, so a copy on a ward machine is safe while the machine is
locked. It opens only with the **kit key**.

### 2.1 One-time setup (IT, per hospital)

1. Set `DOWNTIME_KIT_DIR` and `DOWNTIME_KIT_KEY` (64 hex characters) on the
   HMS server and restart it. The Downtime screen then shows "Kit: current".
2. Write the kit key on the **kit key card**. Seal one card in each ward's
   downtime box and one in the IT safe. The key is not stored in HMS screens,
   e-mail or chat.
3. If the key is lost or a card goes missing: generate a new key, restart
   HMS, and replace every card. Old kits then stop opening, which is what you
   want. Record the change (§5.6).

### 2.2 Each ward machine (IT)

A ward machine is any PC that stays on the ward and has a printer nearby.
Use at least one per ward and one in pharmacy, the laboratory and the
emergency department.

1. On the Downtime screen, **Ward machines → Register**: give the machine a
   name and its ward. HMS shows a **machine token once**; copy it straight
   into the machine's configuration.
2. Copy `backend/scripts/downtime-sync.js` and
   `backend/scripts/downtime-opener.html` to the machine. It needs Node 18 or
   later and nothing else from HMS.
3. Schedule it every 5 minutes (cron on Linux, Task Scheduler on Windows):
   ```
   HMS_URL=https://<hms address> DOWNTIME_STATION_TOKEN=<token> \
   DOWNTIME_LOCAL_DIR=<folder> node downtime-sync.js
   ```
   Optional: also set `DOWNTIME_KIT_KEY` on the machine so each run proves
   the kit opens. Only do this where the machine itself is protected, because
   the key then lives on that machine.
4. Within a few minutes the Downtime screen shows the machine as **Current**.
   A machine that has not stored a current kit for two refresh periods shows
   **Behind**, and HMS opens a worklist item for the administrators. When the
   machine catches up, the item says so; an administrator closes it with a
   note saying what was wrong.
5. Retiring or losing a machine: **Revoke** it on the Downtime screen. Its
   token stops working at once.

### 2.3 Checking distribution (Downtime lead, every shift)

Open the Downtime screen. Every ward machine should be **Current**. If one is
**Behind**, call IT (§5.8). Until it is fixed, that ward uses a printout from
a machine that is current.

---

## 3. Declaring a downtime

**Unplanned:** HMS is unreachable for more than 5 minutes, or is showing
wrong information. **Planned:** maintenance announced at least 24 hours
ahead.

First 15 minutes (Downtime lead):

1. Tell IT on call. Note the time HMS stopped working.
2. If HMS still opens, declare the downtime on the Downtime screen with that
   start time. If it does not open, write the start time on the paper log;
   you declare it in HMS when it returns (the start time can be in the past).
3. On each ward machine, open the newest kit (§4.1) and print it. Check the
   banner: **Current** or **STALE**.
4. Hand out the paper forms: orders, medicine administration, specimen
   labels, receipts and temporary registration.
5. Tell pharmacy, the laboratory, the emergency department and the front desk
   that the hospital is on paper.

---

## 4. Working during downtime

### 4.1 Opening the kit without HMS

- **Any browser:** open `downtime-opener.html` from the kit folder. Choose
  `downtime-latest.hmskit.json`, enter the kit key and select **Open
  summary**, then **Print**. Nothing leaves the machine.
- **Command line (IT):** `DOWNTIME_KIT_KEY=<key> node downtime-open.js
  <kit file>` writes a printable HTML file. Delete it after printing.

**STALE** means the kit is older than its refresh window. Anything ordered,
given or changed after the time printed at the top is not in it. Confirm
allergies and doses with the patient, the bedside chart and the doctor.

"Allergy status unknown" or "not reviewed" means exactly that. It does
**not** mean the patient has no allergies.

### 4.2 Paper records

Write every order, dose given, specimen, payment and new registration on the
paper forms, each with:

- patient name and UHID (or a temporary number from the paper register);
- the **actual time** it happened;
- your name and signature;
- a paper reference number (pre-printed on the form).

Critical laboratory results are phoned to the responsible doctor and written
in the critical-result log with the time and the name of the person told.

---

## 5. Incident response

Severity decides how fast people act:

| Level | Meaning | Response |
|---|---|---|
| **S1** | Patient safety at risk, or HMS unavailable hospital-wide | Declare downtime now; IT on call starts within 15 minutes; clinical lead informed |
| **S2** | One department or function down (e.g. lab results not arriving) | Department goes to paper for that function; IT within 1 hour |
| **S3** | Degraded but usable (slow, one report failing) | Ticket to IT; fix within the working day |

For every S1/S2 incident, keep an incident log: the times, what was seen,
who was told, what was done, and when it was resolved. Attach it to the
incident review.

### 5.1 HMS does not open at all
1. IT: check `GET /api/health` (is the process up?) and `GET /api/ready`
   (does the database answer within 2 seconds?).
2. If health fails: restart the HMS service. If ready fails: check that the
   database service is running and that the disk is not full.
3. If HMS is not back within 15 minutes, follow §3. Do not edit the database
   by hand.

### 5.2 Disk full on the HMS server
Symptoms: HMS stops saving, or the database stops. Free space only from
known-safe places: old logs and temporary files. **Never delete database
files, backups, WAL archives or audit checkpoints.** Then restart and run
§6.

### 5.3 Audit storage warning (worklist "audit")
The tamper-evident audit copy is not being written. Clinical work can
continue. IT fixes the storage connection the same day. The worklist item
closes only with a note.

### 5.4 Lab, device or ABDM messages not arriving
Check the worklist for failed or unmatched messages
(`interface.delivery_failed`, `abdm.*`). The department works on paper for
that flow. After repair, failed messages are retried from the Device
interfaces or Outside records screens; each is resolved with a note.

### 5.5 Wrong information on a patient record
Do not delete anything. The clinician who found it records a correction or a
signed amendment through the normal screens (signed records are never
overwritten). If it may have harmed the patient, report it as a clinical
incident as well.

### 5.6 Lost kit key card, lost ward machine, or suspected data breach
1. Data protection officer informed immediately.
2. Lost machine: revoke it on the Downtime screen.
3. Lost key card: rotate the kit key (§2.1 step 3).
4. Suspected account misuse: a super administrator ends that user's sessions
   (Security screen → Sessions → Force logout) and disables the account.
5. Record what was exposed and when. The data protection officer decides on
   notification under the hospital's policy and the law.

### 5.7 Someone may be using another person's login
Force logout and disable the account (§5.6 step 4). The audit log shows what
was done under that login. Ask IT for an audit report for the period.

### 5.8 A ward machine shows "Behind"
1. Is the machine on and on the network? Is its scheduled job running?
2. Run `downtime-sync.js` by hand on the machine and read its message.
   It says whether HMS could not be reached, the token was refused, or the
   kit did not match.
3. Token refused: register the machine again and update its configuration.

### 5.9 The kit itself is not being made (worklist `downtime.kit_failed`)
IT checks `DOWNTIME_KIT_DIR` (exists and writable, disk space) and that
`DOWNTIME_KIT_KEY` is set. **Refresh now** on the Downtime screen confirms
the fix.

---

## 6. Return to service

When IT says HMS is back:

1. **IT checks before staff log in:**
   - `/api/ready` answers "ready";
   - the Downtime screen shows a freshly made kit ("Refresh now");
   - ward machines turn **Current** again within two refresh periods;
   - the worklist has no new audit-storage or kit failures.
2. **Downtime lead:** if the downtime was not declared in HMS, declare it now
   with the real start time. Then **End** it. HMS opens a worklist item to
   reconcile it.
3. **Each department:** log each paper record against the downtime (kind,
   patient, paper reference, actual time). Then enter it through the normal
   screens. For a medicine dose, use the time it was actually given. Then link
   the entered record to the paper entry.
4. **A second person** checks each entered record against the paper and marks
   it checked. HMS refuses a check by the person who logged or entered it.
5. A paper record that should not be entered (written in error, or a
   duplicate) is voided with a reason.
6. The Downtime lead **closes** the downtime. HMS refuses until every paper
   record is entered and checked, or voided. Closing resolves the worklist
   item.
7. File the paper forms with the downtime's reference, as the hospital's
   records policy requires.

---

## 7. Support procedures

- **First line (department super-users):** passwords, "how do I", printer and
  screen questions. Locked-out users: a super administrator unlocks them on the
  Security screen.
- **Second line (hospital IT):** service restarts, the checks in §5 and §6,
  ward machines, backups (`scripts/backup-db.sh`; restore check
  `scripts/restore-check.sh`).
- **Third line (HMS vendor):** defects and data corrections that the normal
  screens cannot make.

A useful support ticket has:
- the time;
- the user and role;
- the screen;
- the patient's UHID (never a screenshot of the whole record);
- what was expected and what happened;
- the request ID shown in the error message (the server logs carry it).

Staff never fix data directly in the database. Every correction goes through
a screen or a reviewed script, so that it is in the audit log.

---

## 8. Staff rehearsal

Run each drill on the training copy of HMS, never on the live system. Record
it on the sheet in §8.5. A drill counts only if it was actually run with the
named staff.

### Drill A — Kit check (every ward, monthly, 10 minutes)
**Goal:** every shift can open and read the kit without HMS.
1. The Downtime lead takes the key card from the downtime box.
2. A nurse opens `downtime-opener.html` on the ward machine, opens the latest
   kit, and prints it.
3. They find two patients and read out each one's allergy status and next dose
   due.
4. They point to where the time of the kit is printed, and say what STALE
   would mean.

**Pass:** printed within 5 minutes. Allergy status read correctly, including
"unknown". The key card is resealed.

### Drill B — Unplanned downtime tabletop (each department, quarterly, 30 minutes)
**Goal:** everyone knows the first 15 minutes.

Scenario: "HMS stopped at 10:05 during the medication round."
1. The Downtime lead walks through §3.
2. A nurse records two doses given on paper with their real times.
3. A doctor writes one new order on paper.
4. The laboratory phones one critical result and logs it.
5. Pharmacy dispenses against the paper order.

**Pass:** downtime declared (or start time noted). Paper forms complete with
real times and signatures. Critical result logged with the person told.

### Drill C — Return to service (with Drill B, 30 minutes)
**Goal:** every paper record makes it back into HMS and is checked by someone
else.
1. On the training system: declare (back-dated) and end the downtime.
2. Log, enter and link each paper record from Drill B.
3. A different person checks each one. Show that HMS refuses a self-check.
4. Try to close the downtime before everything is checked, and see it
   refused. Then close it.

**Pass:** every record is entered with its real time and checked by a second
person, and the downtime is closed.

### Drill D — Stale kit recognition (every ward, with Drill A, 5 minutes)
**Goal:** staff do not trust an old kit.
The trainer opens an old kit (more than 30 minutes old). Staff must spot the
STALE banner and say what they would confirm at the bedside.

### 8.5 Drill record sheet

| Date | Drill | Ward / department | Staff present (names, roles) | Led by | Passed? | Problems found | Fix owner and date |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

### 8.6 Quick reference card (print one per ward machine)

> **HMS DOWN?** 1) Tell the Downtime lead and IT. 2) Open the downtime box →
> key card. 3) On this PC open **downtime-opener.html** → newest kit → key →
> Print. 4) Check the banner: **STALE** = confirm at the bedside. 5) Write
> everything on the paper forms **with the real time**. 6) Phone critical
> results and log them. When HMS returns: every paper record is entered and
> checked by a **second person** before the downtime is closed.

---

## 9. Evidence and sign-off

Automated drills (software only; no staff involved):

| Check | Where |
|---|---|
| Ward machine registered; sync stores a verified kit; machine shows Current; a tampered or offline pull keeps the previous kit; a revoked token is refused | `e2e/downtimeDrill.e2e.js` |
| Kit opens in a browser with no server; STALE shown on screen and on the printout; a wrong key is named as wrong | `e2e/downtimeDrill.e2e.js` |
| A machine that falls behind is flagged and opens a worklist item | `e2e/downtimeDrill.e2e.js` |
| Kit content, offline opener, declaring and logging, reconciliation by a second person, close refused until complete | `e2e/downtime.e2e.js` |

Owner review (hospital):

| Item | Reviewed by | Date | Decision / changes |
|---|---|---|---|
| Contacts in §1 filled in | | | |
| Procedures §2–§7 approved for this hospital | | | |
| Paper forms approved (orders, administration, specimen, receipt, temporary registration) | | | |
| First Drill A–D completed per ward (sheet §8.5) | | | |

## 10. Releases

A release is done by IT on the HMS server, outside clinic peak hours, with the Downtime lead
told beforehand. Run `scripts/release.sh` from the release checkout. It:

1. keeps the images now running as the rollback point;
2. takes a fresh backup (`scripts/backup-db.sh`) and refuses to continue without one;
3. builds the new images and runs the migrations, then grants the restricted runtime identity
   the new schema. If either fails, nothing running is changed;
4. replaces the worker, then the backend, then the frontend. Each old instance drains first:
   it stops taking new requests and finishes the ones in progress (up to 25 seconds; Docker
   waits 40);
5. waits until the backend and the worker are healthy. If they are not, it puts the previous
   images back and waits for them to be healthy.

| Result | Meaning | What to do |
|---|---|---|
| `RELEASED` (exit 0) | The new version is running and healthy | Check one login and one patient search; record the release |
| `REFUSED` (exit 1) | Backup, build, migration or grant failed | Nothing changed. Read the message, fix, and run again |
| `ROLLED BACK` (exit 1) | The new version was not healthy; the previous one is running | Users may have seen one short interruption. Keep the logs (`docker compose logs backend worker`) and investigate before retrying |
| `ROLLBACK FAILED` / `IMPOSSIBLE` (exit 2) | Neither version is healthy, or there was no previous one | Declare a downtime (section 3) and follow section 6 once HMS is back |

Migrations are never undone by a rollback, so a release may only add to the schema (new
tables, columns, functions); removing or renaming waits for a later release, after no running
version uses the old form. Run `scripts/restore-check.sh` on the new backup after a release.

The worker runs as its own service. Docker restarts it when it exits; it exits when a worker
cannot start or the database stays unreachable. `docker compose ps worker` shows `healthy`
while its heartbeat is fresh.

Evidence: `e2e/release.e2e.js` (order of steps, rollback, failed migration),
`e2e/workerSupervision.e2e.js`, `e2e/drain.e2e.js`.
