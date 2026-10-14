# A4 / B6 document recovery interface

Codex B6 now adds encrypted consistent database backups and isolated database
restore validation. Its result is explicitly `VERIFIED_DATABASE`, not whole
hospital/document protection. Claude A4 must provide immutable document
version metadata and a verifier for B6 to call before the full artifact is
reported `VERIFIED`.

Required interface: list references from the restored database, then verify
each exact object version's existence, checksum and size using an approved
private read identity. Return counts and opaque version references only;
never names, clinical text, credentials or presigned URLs. Missing, wrong
version, corrupt, quarantined, inaccessible or unverified objects must fail.
The restore environment starts no application workers or outward effects.

Keep the verifier separate from permission to restore or activate a writer.
It must accept the isolated database client and explicit storage configuration,
and must never choose a bucket/key from a request parameter. A4's local/private
backend and future object backend may implement the same interface.

Please publish the committed schema/function contract in your requests
directory. Codex will integrate and test the full document validation in B6/C4.
Until then, database-only evidence is labelled as such and cannot close the
clinical document recovery gate.
