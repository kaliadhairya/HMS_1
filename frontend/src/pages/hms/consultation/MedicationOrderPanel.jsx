import { useEffect, useState } from "react";
import api from "../../../api/axios";
import {
  Field,
  Select,
  SaveStatus,
  useCommand,
  useRows,
  Findings,
  timeInput,
  iso,
  V2,
  publicId,
  only,
} from "../pharmacy/MedicationUI";
const empty = {
  product_id: "",
  dose: "",
  dose_unit: "",
  route: "",
  interval_minutes: "",
  starts_at: "",
  ends_at: "",
  supply_quantity: "",
  supply_unit: "",
  prn: false,
  indication: "",
  max_dose: "",
  max_period_hours: "",
  min_interval_minutes: "",
};
export default function MedicationOrderPanel({ patientId, encounterId, onPendingChange }) {
  const products = useRows("/products");
  const data = useRows(
    "/orders" + (encounterId ? "?encounter_id=" + encounterId : ""),
  );
  const command = useCommand(data.refresh);
  const [ids, setIds] = useState(null);
  useEffect(() => {
    let live = true;
    setIds(null);
    if (!patientId || !encounterId) return undefined;
    Promise.all([publicId("patient", patientId), publicId("encounter", encounterId)])
      .then(([patient, encounter]) => live && setIds({ patient, encounter }))
      .catch(() => live && setIds(false));
    return () => {
      live = false;
    };
  }, [patientId, encounterId]);
  const [form, setForm] = useState(empty),
    [action, setAction] = useState(null),
    [assessment, setAssessment] = useState(null),
    [reason, setReason] = useState(""),
    [overrides, setOverrides] = useState({});
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    const unsaved = Object.keys(empty).some((key) => form[key] !== empty[key]);
    onPendingChange?.(data.state.kind !== 'current' || unsaved || data.rows.some((row) => row.state === 'DRAFT') ||
      command.saving || command.status.kind === 'pending_confirmation');
  }, [form, data.rows, data.state.kind, command.saving, command.status.kind, onPendingChange]);
  const choose = (value) => {
    const p = products.rows.find((p) => p.id === value);
    setForm((f) => ({
      ...f,
      product_id: value,
      dose_unit: p?.base_unit || "",
      route: p?.route || "",
      supply_unit: p?.base_unit || "",
    }));
  };
  const submit = async (e) => {
    e.preventDefault();
    const decimal = (v) => (v === "" || v == null ? undefined : String(v));
    const values = {
      product_id: form.product_id,
      dose: decimal(form.dose),
      dose_unit: form.dose_unit,
      route: form.route,
      frequency: { type: "INTERVAL", interval_minutes: Number(form.interval_minutes) },
      starts_at: iso(form.starts_at),
      ends_at: iso(form.ends_at),
      prn: Boolean(form.prn),
      indication: form.indication,
      max_dose: decimal(form.max_dose),
      max_period_hours: decimal(form.max_period_hours),
      min_interval_minutes:
        form.min_interval_minutes === "" || form.min_interval_minutes == null
          ? undefined
          : Number(form.min_interval_minutes),
      supply_quantity: decimal(form.supply_quantity),
      supply_unit: form.supply_unit,
    };
    const content = only(Object.keys(values), values);
    const saved =
      action?.type === "amend"
        ? await command.run(
            "/medication-orders/" + action.row.id + "/amend",
            { ...content, reason },
            action.row.api_version,
            V2,
          )
        : await command.run(
            "/medication-orders",
            { patient_id: ids.patient, encounter_id: ids.encounter, ...content },
            undefined,
            V2,
          );
    if (saved) {
      setForm(empty);
      setAction(null);
      setReason("");
    }
  };
  const begin = async (row, type) => {
    setAction({ row, type });
    setReason("");
    setAssessment(null);
    setOverrides({});
    if (type === "sign") {
      const a = await command.run(
        "/orders/" + row.id + "/assess",
        {},
        row.revision,
      );
      if (a) setAssessment(a);
    }
    if (type === "amend") {
      setForm({
        ...empty,
        ...row,
        interval_minutes: row.frequency.interval_minutes,
        starts_at: timeInput(row.starts_at),
        ends_at: timeInput(row.ends_at),
      });
    }
  };
  const act = async (e) => {
    e.preventDefault();
    const b =
      action.type === "sign"
        ? {
            reason,
            override_requests: Object.entries(overrides).map(
              ([finding_code, reason]) => ({ finding_code, reason }),
            ),
          }
        : { reason };
    // The safety assessment before signing changes the order's public version but not its content;
    // the reviewed content is the same revision, so its current public version is the one to send.
    const current = data.rows.find((r) => r.id === action.row.id);
    const version =
      current && current.revision === action.row.revision ? current.api_version : action.row.api_version;
    const result = await command.run(
      "/medication-orders/" + action.row.id + "/" + action.type,
      b,
      version,
      V2,
    );
    if (result) {
      setAction(null);
      setReason("");
      setAssessment(null);
    }
  };
  return (
    <section
      aria-label="Coded medication orders"
      className="panel medication-panel"
      style={{ padding: 16 }}
    >
      <h2>Coded medication orders</h2>
      <p>
        Each signed version is preserved. Signing runs server safety checks;
        supply and eMAR require independent pharmacist verification.
      </p>
      <SaveStatus value={data.state} />
      <SaveStatus value={command.status} />
      <button type="button" className="btn btn-ghost" onClick={data.refresh}>
        Refresh orders
      </button>
      {(!action || action.type === "amend") && patientId && encounterId && (
        <form
          onSubmit={submit}
          className="stack"
          aria-label={
            action ? "Amend medication order" : "Create medication order"
          }
        >
          <Select
            label="Approved product"
            required
            value={form.product_id}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">Select a coded identity</option>
            {products.rows
              .filter((p) => p.status === "APPROVED")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.strength} {p.strength_unit}, {p.dose_form},{" "}
                  {p.route}
                </option>
              ))}
          </Select>
          <div className="form-grid">
            <Field
              label="Dose"
              required
              inputMode="decimal"
              value={form.dose}
              onChange={(e) => update("dose", e.target.value)}
            />
            <Field
              label="Dose unit"
              required
              value={form.dose_unit}
              onChange={(e) => update("dose_unit", e.target.value)}
            />
            <Field
              label="Route"
              required
              value={form.route}
              onChange={(e) => update("route", e.target.value)}
            />
            <Field
              label="Interval (minutes)"
              type="number"
              min="1"
              required
              value={form.interval_minutes}
              onChange={(e) => update("interval_minutes", e.target.value)}
            />
            <Field
              label="Starts at"
              type="datetime-local"
              required
              value={form.starts_at}
              onChange={(e) => update("starts_at", e.target.value)}
            />
            <Field
              label="Ends at"
              type="datetime-local"
              required
              value={form.ends_at}
              onChange={(e) => update("ends_at", e.target.value)}
            />
            <Field
              label="Authorized supply quantity"
              inputMode="decimal"
              required
              value={form.supply_quantity}
              onChange={(e) => update("supply_quantity", e.target.value)}
            />
            <Field
              label="Supply base unit"
              required
              value={form.supply_unit}
              onChange={(e) => update("supply_unit", e.target.value)}
            />
          </div>
          <label>
            <input
              type="checkbox"
              checked={form.prn}
              onChange={(e) => update("prn", e.target.checked)}
            />{" "}
            PRN order
          </label>
          {form.prn && (
            <div className="form-grid">
              {[
                ["indication", "PRN indication"],
                ["max_dose", "PRN maximum dose"],
                ["max_period_hours", "PRN maximum period (hours)"],
                ["min_interval_minutes", "PRN minimum interval (minutes)"],
              ].map(([k, label]) => (
                <Field
                  key={k}
                  label={label}
                  required
                  value={form[k]}
                  onChange={(e) => update(k, e.target.value)}
                />
              ))}
            </div>
          )}
          {action && (
            <Field
              label="Amendment reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          {ids === false && (
            <p role="alert">This visit could not be identified for ordering. Reload the consultation.</p>
          )}
          <button className="btn btn-primary" disabled={command.saving || (!action && !ids)}>
            {command.saving
              ? "Saving…"
              : action
                ? "Create amended version"
                : "Save coded draft"}
          </button>
        </form>
      )}
      {action && action.type !== "amend" && (
        <form onSubmit={act} aria-label="Order transition">
          <h3>
            {action.type} order version {action.row.current_version}
          </h3>
          {assessment && (
            <Findings
              findings={assessment.findings}
              coverage={assessment.coverage}
            />
          )}
          {assessment?.findings
            .filter((f) => f.severity === "BLOCK" && f.override_allowed)
            .map((f) => (
              <Field
                key={f.code}
                label={"Requested override reason: " + f.code}
                required
                value={overrides[f.code] || ""}
                onChange={(e) =>
                  setOverrides({ ...overrides, [f.code]: e.target.value })
                }
              />
            ))}
          <Field
            label="Clinical transition reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={command.saving || (action.type === "sign" && !assessment)}
          >
            Confirm {action.type}
          </button>{" "}
          <button type="button" onClick={() => setAction(null)}>
            Cancel
          </button>
        </form>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Order / identity</th>
              <th>State</th>
              <th>Intended dose</th>
              <th>Verification / supply</th>
              <th>Commands</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.product_snapshot.name || "Ingredient order"}
                  <br />
                  <small>
                    Stable ID {row.id} · version {row.current_version}, revision{" "}
                    {row.revision}
                  </small>
                </td>
                <td>{row.state}</td>
                <td>
                  {row.dose} {row.dose_unit} · {row.route}
                </td>
                <td>
                  {row.verification_state || "Not verified"} · {row.remaining}{" "}
                  {row.supply_unit} remaining
                </td>
                <td>
                  {(row.state === "DRAFT"
                    ? ["sign"]
                    : row.state === "SIGNED"
                      ? ["hold", "discontinue", "amend"]
                      : row.state === "HELD"
                        ? ["resume", "discontinue", "amend"]
                        : []
                  ).map((type) => (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      key={type}
                      disabled={command.saving}
                      onClick={() => begin(row, type)}
                    >
                      {type}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.rows.length && data.state.kind === "current" && (
        <p>No coded orders recorded for this context.</p>
      )}
    </section>
  );
}
