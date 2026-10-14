# Clinical runtime preparation

The completion artifacts target Node 24 (at least 24.12 for stable native
TypeScript stripping) and PostgreSQL 18. CI checks the new TypeScript domains,
fresh schemas and legacy upgrades on PostgreSQL 16 and 18. It publishes
candidate metadata; a push does not deploy a hospital.

The PostgreSQL 18 Compose files deliberately use **new** data volumes:
`hms-db-data18` for development and `hms_pgdata18` for production. PostgreSQL
18 mounts `/var/lib/postgresql`. Existing PostgreSQL 16 volumes are retained.
Changing an image does not upgrade an existing database, and starting these
files against an unprepared host would present a fresh database. Follow a
reviewed migration/cutover before any live use.

Rehearse a complete logical export and restore on isolated PostgreSQL 18,
including extensions, roles/grants, checksums, clinical audit, documents,
financial and stock reconciliation. Record the source snapshot and measured
duration. At cutover, drain the old writer, take the final consistent copy,
validate it, fence old credentials/tasks and switch the approved application.
Keep the old writer fenced and retained during the rollback window. Writes
made on the new writer need explicit reconciliation before a rollback.

The WAL archive helper verifies identical retries and never overwrites a
different or corrupt segment. Archive/base-backup volumes are initialized
with private PostgreSQL ownership. Local volumes alone do not provide
regional protection; protected off-host copies and recovery drills remain
separate acceptance requirements.

No running container, shared database or AWS resource was changed while
preparing these artifacts. Migration tests used private throwaway databases.

References: [Node TypeScript support](https://nodejs.org/docs/latest-v24.x/api/typescript.html),
[PostgreSQL major upgrades](https://www.postgresql.org/docs/18/upgrading.html),
[official PostgreSQL image volume guidance](https://github.com/docker-library/postgres/blob/master/README.md).
