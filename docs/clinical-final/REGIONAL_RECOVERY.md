# Regional recovery and fencing (completion B7)

Builds on Codex's B6 database recovery core (`a757ac5`,
`docs/clinical-final/RECOVERY.md`):
- encrypted logical backups;
- full-invariant restore validation;
- PITR and standby drills with measured RPO/RTO.

B7 adds what happens when the hospital actually switches to the recovered
or standby database:
- exactly one writer;
- no old sessions;
- no blind re-sending of effects whose outcome is unknown;
- the configuration for a second region.

Targets from the blueprint: **RPO ≤ 5 minutes, RTO ≤ 60 minutes**, demonstrated
by drills in the target regions.

## What the software guarantees

| Risk after a failover | Control | Where |
|---|---|---|
| Two databases accepting writes (split brain) | Every database has a **writer fence** (cluster ID, epoch, role). Promotion first **fences the old primary**: it is marked fenced, made read-only, its connections are ended, and a write probe must fail. Only then does the new primary take a higher epoch. If the old primary cannot be reached, promotion is **refused** unless `OLD_PRIMARY_ISOLATION` records how it was cut off (network change, ticket). | `scripts/recovery-promote.cts`, migration 0154 |
| An HMS instance still attached to the old database | It reports **not ready** (load balancers stop sending work), its writes fail (read-only), and HMS **refuses to start** on a fenced database. A fenced database becomes primary again only by a new promotion to a higher epoch. | `services/writerFence.cts`, `server.js`, `worker.js` |
| Sessions revoked after the recovery point coming back | Promotion **revokes every session**; everyone signs in again. | promotion transaction |
| Messages delivered just before the failure being sent twice, or lost | Outbound messages still pending at the recovery point (SMS, ABDM, devices, interfaces) are **held**, not re-sent, and a worklist item asks staff to confirm with each receiving system and then release or cancel them. | promotion transaction |
| Payments whose result came after the recovery point | Initiated/pending payments become **Unknown**. The finance reconciliation (A7) then requires the provider's confirmation, and a worklist item says so. | promotion transaction |
| No record of what happened | Each promotion is an **append-only recovery event**: epoch, previous cluster, how the old primary was handled, isolation evidence, last recorded change, counts and timings. | `hms_recovery_events` |
| Live events lost in the gap | Events still in the outbox are delivered by catch-up (`/events`, A8). Screens re-read from the database. | existing |

## Runbook: switch to the recovered or standby database

Roles: the IT lead runs it; the hospital's clinical lead declares downtime
(see `OPERATIONS.md` §3).

1. **Declare downtime.** Wards switch to the downtime kits (C6). Stop
   directing users to HMS.
2. **Choose the target:**
   - the standby in the second region (streaming replica, see
     *Configuration*);
   - or a database restored with Codex's `clinical-backup.cts verify` /
     PITR scripts. Use only artifacts that verified as `VERIFIED_DATABASE`,
     with the document verifier once A4/B6 integration is complete.
3. **Fence the old primary.** If its region is reachable, give `OLD_DB_*`;
   the tool fences and proves it. If not, cut it off at the network or
   cloud level first, then put that change reference in
   `OLD_PRIMARY_ISOLATION`.
4. **Promote** (recovery/owner identity, never the application identity):
   ```sh
   RECOVERY_REASON="Region A outage, incident INC-…" \
   NEW_DB_HOST=… NEW_DB_PORT=… NEW_DB_NAME=hms NEW_DB_USER=… NEW_DB_PASSWORD=… \
   OLD_DB_HOST=… OLD_DB_NAME=hms … \            # or OLD_PRIMARY_ISOLATION="CHG-…"
   node backend/scripts/recovery-promote.cts [--promote-standby]
   ```
   It prints the evidence (JSON). Keep it with the incident record.
5. **Start HMS** in the recovery region against the new primary
   (`HMS_PROCESS_ROLE=api` instances and one `node worker.js`). Wait for
   `/api/ready`.
6. **Return to service** (`OPERATIONS.md` §6):
   - staff sign in again;
   - work the worklist items `recovery.delivery_unknown` and
     `recovery.payment_unknown`;
   - enter the downtime paper records;
   - check that ward machines turn Current.
7. **Measure.** RPO is the last change on the old primary (from its logs or
   archive) minus the event's `last_recorded_change`. RTO is from the
   downtime declaration to step 5. Record both below.

Never point HMS at a database that is not the newest epoch. Rebuild the old
primary as a new standby; do not "un-fence" it.

## Configuration for a second region (to be applied by the deployment owner)

- **Database:** a streaming standby in the second region, plus WAL archiving
  to object storage with object lock in both regions (Codex
  `scripts/archive-wal.sh`). Managed equivalent: RDS for PostgreSQL 18
  Multi-AZ, with a cross-region read replica or automated backups replicated
  to the second region.
- **Standby (self-managed) `postgresql.conf` / `primary_conninfo`:**
  ```
  primary_conninfo = 'host=<primary> port=5432 user=replicator sslmode=verify-full application_name=hms_dr'
  restore_command  = '<fetch WAL from the archive>'
  hot_standby = on
  ```
  The `replicator` role has REPLICATION only; its password lives in the
  secret store.
- **Application:** the same image in both regions. Keep the region-B
  instances stopped (or `/api/ready` failing) until promotion. Region B needs:
  - the same `HMS_DATA_KEYS` (A4);
  - the same `BACKUP_ENCRYPTION_KEY` versions (B6);
  - the same `DOWNTIME_KIT_KEY` (C6);
  - its own `HMS_DOCUMENT_DIR` replicated from region A (object storage
    with versioning; exact versions verified through the A4/B6 interface).
- **Traffic:** DNS or a global load balancer whose health check is
  `/api/ready`. A fenced instance fails it automatically.
- **Secrets:** a separate recovery identity (database owner) for the
  promotion tool; the application identity cannot change database
  settings (Codex A2 production check).

## Evidence

Local drill (software, same host, disposable copies): `e2e/recoveryDrill.e2e.js`
- old primary fenced and proven read-only;
- HMS there not ready, refused writes, refused to start;
- promotion refused without fencing or isolation evidence;
- sessions revoked, messages held, payments Unknown, worklist items opened;
- recovery event append-only;
- measured RPO window and RTO saved as JSON.

Target-region evidence (to be recorded; not producible locally):

| Drill | Date | Regions | RPO measured | RTO measured | Old primary fenced or isolated (reference) | Who |
|---|---|---|---|---|---|---|
| Planned switchover | | | | | | |
| Unplanned region loss | | | | | | |
| Restore from backup (`VERIFIED`, incl. documents) | | | | | | |
