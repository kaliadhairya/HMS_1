# Request from Phase 5 to Phase 4: keep the lab charge source

Phase 5 records a charge when a lab test is ordered, through a database
trigger on `hms_investigation_order_items` (migration 0071):

- an inserted item that is not `Cancelled` creates one charge event with
  source `lab_order_item:<item id>`;
- an item whose status changes to `Cancelled` gets a linked reversal.

No Phase 4 file is edited. If Phase 4 replaces or renames
`hms_investigation_order_items`, or cancels tests some other way, please
tell Phase 5 (AGENTS.md) so the trigger can follow, or call
`billing_capture_charge(...)` from the new path. A test must not be charged
twice for one order item; re-collection of a specimen is not a new charge.
