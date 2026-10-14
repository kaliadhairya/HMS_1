# Laboratory operating workflow

Use `/lab/governed`, or the existing laboratory Queue, Samples, Results or
Reports links. All four laboratory entry URLs use the governed workspace.

1. A doctor in the patient's care selects approved coded test/panel versions
   and the current encounter. Finalized encounters cannot accept new orders.
2. Collection staff plan accessions against the declared test requirements.
   Several tests may share an accession. A test needing several specimen
   types remains blocked until every required type has an acceptable receipt.
3. Confirm the patient and accession from the label for each custody event.
   Record actual collection, sending, receipt and storage. Rejection records
   a reason and durable recollection. A received replacement closes only its
   corresponding recollection requirement. Aliquots retain their parent.
4. Enter observed values, units and methods. Approved conversions are the
   only way to normalize a different unit. Missing reference configuration
   stays visible. A conflicting result retains the browser draft and needs
   explicit review of the latest revision before resubmission.
5. Record actual QC evidence against the approved QC rule and analyzer run.
   A reviewer with a current technical-review grant verifies the exact
   current result or requests repeat processing. Failed/repeat QC cannot be
   released. Reviewed results require a linked correction and reason.
6. A doctor with a current release grant signs a preliminary, final or
   amended report. Final/amended reports include every active analyte. PDFs
   and report reads identify an exact immutable report version.
7. A verified critical result opens a separate durable task immediately;
   final report release is not a prerequisite. Queueing an alert, recording
   contact, opening a report and acknowledging it are distinct activities.
   A responsible clinician acknowledges, then records an action/disposition
   before closure. Discharge never silently closes the task.
8. An amended critical result opens a new communication cycle; old reports,
   result versions, tasks and contact evidence remain retained.

An administrator grants time-limited CONTENT, TECHNICAL_REVIEW, RELEASE or
ANALYZER privileges with a recorded reason. Report RELEASE is limited to
clinical doctor accounts. Administrative roles cannot authorize a report.
Clinical content approvals require a CONTENT grant and provenance/effective
versions. Nothing is automatically approved from a commercial or role label.

Reference intervals, critical policies, QC rules and escalation timetables
ship empty. Declare both bound inclusivity values when approving reference
or critical configuration. Coarse whole-year ages cannot select a narrower
age policy than their known age interval. Overlapping applicable policies
are refused for reconciliation; no ambiguous policy is selected silently.

Unmatched analyzer messages retain their original source, stable message ID,
contract, accession and patient context. A laboratory adapter account uses
contract version 1 and an ANALYZER grant. Duplicate IDs with different content
are refused. Imported results remain provisional until technical verification.
Use Reconciliation to explicitly match pending identities. This does not
rewrite the original message or manufacture a specimen receipt.

Run the dedicated escalation worker separately from API startup:

```sh
# Supply tenant database environment through protected configuration.
# Use a dedicated active lab_technician account with TECHNICAL_REVIEW privilege.
LAB_ESCALATION_WORKER_USER_ID=<user-id> \
LAB_ESCALATION_POLL_MS=<explicit-poll-interval> \
node backend/scripts/laboratory-escalation-worker.js
```

Polling cadence is infrastructure configuration, not a clinical timetable.
The worker claims due tasks with transactional row locks and follows each
immutable approved schedule. A crash rolls back the step; retry does not
create a second escalation for an already advanced level. Supervise/restart
failed workers and monitor overdue open tasks. `LAB_ESCALATION_ONCE=true`
executes a single batch for validation. Until deployed, the laboratory UI
can process due approved escalations through the same durable command.

Historical report editors are read-only. Historical free-text ranges and PDFs
are labelled historical evidence, not validated release signatures. Patient
care-team restrictions apply before content/PDF delivery; read auditing must
succeed before the first response byte.

If a save outcome is uncertain, keep the screen open and reconcile the original
request. Do not create another dose/result/report to compensate for a lost
response. The browser reuses the original body and request identity. A refused
or stale command leaves the draft available for deliberate correction.
