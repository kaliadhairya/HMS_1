import { useEffect, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import api from "../../../api/axios";
import { WitnessRequest } from "./MedicationWitness";
import { commandKey } from "./medicationCommand.mjs";
import Navbar from "../../../components/Navbar";
import {
  Field,
  Select,
  SaveStatus,
  MedicationLinks,
  useCommand,
  useRows,
  iso,
  timeInput,
} from "./MedicationUI";
export default function MedicationNursingPage() {
  const { user } = useAuth();
  const rows = useRows("/emar"),
    orders = useRows("/orders"),
    tasks = useRows("/tasks"),
    handovers = useRows("/handovers"),
    staff = useRows("/staff");
  const lateReviews = useRows("/late-documentation-requests");
  const [lateReason, setLateReason] = useState("");
  const command = useCommand(async () => {
    await rows.refresh();
    await tasks.refresh();
    await handovers.refresh();
  });
  const storageKey = "hms:medication-documentation:" + user.id;
  const [pending, setPending] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || "null");
    } catch {
      return null;
    }
  });
  const [selected, setSelected] = useState(null),
    [supplies, setSupplies] = useState([]),
    [form, setForm] = useState(null),
    [scheduleOrder, setScheduleOrder] = useState(""),
    [through, setThrough] = useState(""),
    [indication, setIndication] = useState("");
  const [handover, setHandover] = useState({
    patient_id: "",
    receiver_user_id: "",
    situation: "",
    background: "",
    assessment: "",
    recommendation: "",
  });
  const select = async (r) => {
    setSelected(r);
    setForm({
      patient_id: r.patient_id,
      product_id: r.product_id,
      dispense_line_id: r.documentation_scan_evidence?.dispense_line_id || "",
      dose: r.dose,
      dose_unit: r.dose_unit,
      route: r.route,
      outcome: "GIVEN",
      actual_at: r.documentation_intent_id
        ? ""
        : new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 23),
      reason: "",
      witness_id: "",
      scan_evidence: r.documentation_scan_evidence || {
        mode: "BARCODE",
        patient_identifier: "",
        product_barcode: "",
        product_id: r.product_id,
        reason: "",
        identity_confirmed: false,
        dose_checked: false,
        route_checked: false,
        time_checked: false,
      },
    });
    try {
      const result = await api.get("/medication/orders/" + r.order_id);
      setSupplies(
        result.data.data.dispenses.filter((d) => d.version_id === r.version_id),
      );
    } catch {
      setSupplies([]);
    }
  };
  const payload = () => ({
    ...form,
    actual_at: iso(form.actual_at),
    ...(form.witness_id
      ? { witness_id: form.witness_id }
      : { witness_id: undefined }),
  });
  const persist = (p) => {
    setPending(p);
    if (p) sessionStorage.setItem(storageKey, JSON.stringify(p));
    else sessionStorage.removeItem(storageKey);
  };
  useEffect(() => {
    if (
      pending &&
      rows.rows.some(
        (r) =>
          r.id === pending.schedule_id &&
          r.administration_id &&
          r.performer_user_id === user.id &&
          r.outcome === pending.body.outcome,
      )
    ) {
      persist(null);
      setSelected(null);
    }
  }, [rows.rows, pending, user.id]);
  const record = async (p) => {
    const r = await command.run(
      "/emar/" + p.schedule_id + "/record",
      p.body,
      undefined,
      {
        key: p.key,
        reconciling: command.status.kind === "pending_confirmation",
      },
    );
    if (r) {
      persist(null);
      setSelected(null);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    const b = payload();
    if (b.outcome === "GIVEN") {
      const p = { schedule_id: selected.id, key: commandKey(), body: b };
      persist(p);
      await record(p);
    } else if (await command.run("/emar/" + selected.id + "/record", b))
      setSelected(null);
  };
  const scan = (k, v) =>
    setForm((f) => ({ ...f, scan_evidence: { ...f.scan_evidence, [k]: v } }));
  const generate = async (e) => {
    e.preventDefault();
    const o = orders.rows.find((r) => r.id === scheduleOrder);
    if (!o) return;
    await command.run(
      "/orders/" + o.id + (o.prn ? "/prn" : "/schedules"),
      o.prn
        ? { scheduled_at: iso(through), indication }
        : { through_at: iso(through) },
      o.revision,
    );
  };
  return (
    <>
      <Navbar />
      <MedicationLinks />
      <main className="app-page medication-page">
        <h1>eMAR and nursing handover</h1>
        <SaveStatus value={rows.state} />
        <SaveStatus value={command.status} />
        <button onClick={rows.refresh}>Refresh eMAR</button>
        {pending && (
          <section role="alert" className="alert-strip alert-warning">
            <div>
              <h2>Pending documentation — do not repeat the dose</h2>
              <p>
                The dose may already have been given. Reconcile occurrence{" "}
                {pending.schedule_id}; this button retries only its original
                documentation request.
              </p>
              <button disabled={command.saving} onClick={() => record(pending)}>
                Reconcile original documentation
              </button>
              <Field
                label="Prior-documentation review request reason"
                value={lateReason}
                onChange={(e) => setLateReason(e.target.value)}
              />
              <button
                disabled={command.saving || !lateReason}
                onClick={async () => {
                  await command.run(
                    "/emar/" + pending.schedule_id + "/request-late-review",
                    { documentation: pending.body, reason: lateReason },
                  );
                  await lateReviews.refresh();
                }}
              >
                Request prescriber review of prior dose
              </button>
              <button type="button" onClick={lateReviews.refresh}>
                Refresh prescriber review
              </button>
              {lateReviews.rows
                .filter(
                  (r) => r.schedule_id === pending.schedule_id && r.review_id,
                )
                .map((r) => (
                  <button
                    key={r.id}
                    disabled={command.saving}
                    onClick={() => {
                      const reviewed = {
                        ...pending,
                        key: commandKey(),
                        body: { ...pending.body, late_review_id: r.review_id },
                      };
                      persist(reviewed);
                      record(reviewed);
                    }}
                  >
                    Document prior dose under signed prescriber review
                  </button>
                ))}
            </div>
          </section>
        )}
        <form onSubmit={generate} className="form-grid">
          <Select
            label="Verified order to schedule"
            required
            value={scheduleOrder}
            onChange={(e) => setScheduleOrder(e.target.value)}
          >
            <option value="">Choose order</option>
            {orders.rows
              .filter(
                (o) =>
                  o.state === "SIGNED" && o.verification_state === "VERIFIED",
              )
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.patient_name} / {o.product_snapshot.name} / v
                  {o.current_version}
                  {o.prn ? " (PRN)" : ""}
                </option>
              ))}
          </Select>
          <Field
            label="Schedule through / PRN occurrence time"
            type="datetime-local"
            required
            value={through}
            onChange={(e) => setThrough(e.target.value)}
          />
          <Field
            label="PRN occurrence indication"
            value={indication}
            onChange={(e) => setIndication(e.target.value)}
          />
          <button disabled={command.saving}>
            Generate authorized occurrences
          </button>
        </form>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Verified order / intended time</th>
              <th>Outcome</th>
              <th>Actual / recorded time</th>
              <th>Documentation</th>
            </tr>
          </thead>
          <tbody>
            {rows.rows.map((r) => (
              <tr key={r.id} data-occurrence-id={r.id}>
                <td>
                  {r.patient_name} / {r.uhid}
                </td>
                <td>
                  {r.product_snapshot.name} · {r.dose} {r.dose_unit} · {r.route}
                  <br />
                  {new Date(r.scheduled_at).toLocaleString()} · order{" "}
                  {r.order_state}
                </td>
                <td>{r.state}</td>
                <td>
                  {r.actual_at ? new Date(r.actual_at).toLocaleString() : "—"} /{" "}
                  {r.recorded_at
                    ? new Date(r.recorded_at).toLocaleString()
                    : "—"}
                  {r.corrections.length > 0 && (
                    <strong> Linked correction on record</strong>
                  )}
                </td>
                <td>
                  {r.documentation_state === "PENDING_DOCUMENTATION" && (
                    <strong>Pending documentation — never repeat</strong>
                  )}
                  {(r.state === "PENDING" ||
                    r.documentation_state === "PENDING_DOCUMENTATION") && (
                    <button
                      disabled={Boolean(pending)}
                      onClick={() => select(r)}
                    >
                      {r.documentation_intent_id
                        ? "Reconcile documentation"
                        : "Bedside checks"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {selected && form && (
          <section className="panel" style={{ padding: 16 }}>
            <h2>
              {selected.patient_name} — {selected.uhid}
            </h2>
            <p>
              {selected.product_snapshot.name} · {selected.dose}{" "}
              {selected.dose_unit} · {selected.route}. Confirm patient, product,
              dose, route and intended time at bedside.
            </p>
            {selected.documentation_intent_id && (
              <p role="alert">
                This occurrence is claimed. Confirm whether the physical dose
                was already given. Do not give another dose.
              </p>
            )}
            <form onSubmit={submit} className="stack">
              <Select
                label="Supplied line"
                required={form.outcome === "GIVEN"}
                value={form.dispense_line_id}
                onChange={(e) =>
                  setForm({ ...form, dispense_line_id: e.target.value })
                }
              >
                <option value="">Choose supplied lot</option>
                {supplies.map((l) => (
                  <option key={l.id} value={l.id}>
                    Lot {l.batch_id} · {l.quantity} {l.unit} · {l.id}
                  </option>
                ))}
              </Select>
              <Select
                label="Bedside verification method"
                value={form.scan_evidence.mode}
                onChange={(e) => scan("mode", e.target.value)}
              >
                <option value="BARCODE">Scan wristband and product</option>
                <option value="MANUAL">Documented manual fallback</option>
              </Select>
              <Field
                label="Scanned / confirmed patient identifier"
                required
                value={form.scan_evidence.patient_identifier}
                onChange={(e) => scan("patient_identifier", e.target.value)}
              />
              {form.scan_evidence.mode === "BARCODE" ? (
                <Field
                  label="Product barcode"
                  required
                  value={form.scan_evidence.product_barcode}
                  onChange={(e) => scan("product_barcode", e.target.value)}
                />
              ) : (
                <>
                  <Field
                    label="Manual fallback reason"
                    required
                    value={form.scan_evidence.reason}
                    onChange={(e) => scan("reason", e.target.value)}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={form.scan_evidence.identity_confirmed}
                      onChange={(e) =>
                        scan("identity_confirmed", e.target.checked)
                      }
                    />{" "}
                    Positively confirmed patient and approved product identity
                  </label>
                </>
              )}
              {["dose", "route", "time"].map((k) => (
                <label key={k}>
                  <input
                    type="checkbox"
                    checked={form.scan_evidence[k + "_checked"]}
                    onChange={(e) => scan(k + "_checked", e.target.checked)}
                  />{" "}
                  Confirmed intended {k}
                </label>
              ))}
              <Select
                label="Dose outcome"
                value={form.outcome}
                onChange={(e) => setForm({ ...form, outcome: e.target.value })}
              >
                {["GIVEN", "HELD", "REFUSED", "OMITTED"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
              <Field
                label="Actual occurrence time"
                type="datetime-local"
                step="0.001"
                required
                value={form.actual_at}
                onChange={(e) =>
                  setForm({ ...form, actual_at: e.target.value })
                }
              />
              <Field
                label="Exception / late documentation reason"
                required={form.outcome !== "GIVEN"}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
              {selected.product_snapshot.controlled && (
                <>
                  <WitnessRequest
                    action="ADMINISTRATION"
                    subjectId={selected.id}
                    details={{
                      ...form,
                      actual_at: form.actual_at ? iso(form.actual_at) : "",
                    }}
                    onAttestation={(witness_id) =>
                      setForm({ ...form, witness_id })
                    }
                  />
                  <p role="alert">
                    Controlled drug: an independent witness must observe the
                    action and attest the exact record.
                  </p>
                  <Field
                    label="Administration witness attestation ID"
                    required
                    value={form.witness_id}
                    onChange={(e) =>
                      setForm({ ...form, witness_id: e.target.value })
                    }
                  />
                </>
              )}
              {form.outcome === "GIVEN" && !selected.documentation_intent_id ? (
                <button
                  type="button"
                  disabled={command.saving || Boolean(pending)}
                  onClick={async (e) => {
                    if (!e.currentTarget.closest("form").reportValidity())
                      return;
                    const result = await command.run(
                      "/emar/" + selected.id + "/prepare",
                      payload(),
                    );
                    if (result)
                      setSelected({
                        ...selected,
                        documentation_intent_id: result.id,
                      });
                  }}
                >
                  Confirm bedside checks and reserve documentation
                </button>
              ) : (
                <button disabled={command.saving || Boolean(pending)}>
                  Record outcome; do not administer again
                </button>
              )}
            </form>
          </section>
        )}
        <h2>Outstanding medication tasks</h2>
        <ul>
          {tasks.rows.map((t) => (
            <li key={t.id}>
              {t.kind}: {t.detail} — {t.state}{" "}
              <button
                disabled={command.saving}
                onClick={() => {
                  const reason =
                    t.state === "ACKNOWLEDGED"
                      ? window.prompt("Clinical action / closure reason")
                      : undefined;
                  if (t.state === "ACKNOWLEDGED" && !reason) return;
                  command.run("/tasks/" + t.id, {
                    state: t.state === "OPEN" ? "ACKNOWLEDGED" : "CLOSED",
                    reason,
                  });
                }}
              >
                {t.state === "OPEN"
                  ? "Acknowledge task"
                  : "Record clinical action and close"}
              </button>
            </li>
          ))}
        </ul>
        <section className="panel" style={{ padding: 16 }}>
          <h2>SBAR responsibility handover</h2>
          <p>
            Responsibility stays with the sender until the receiving nurse
            acknowledges.
          </p>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              await command.run("/handovers", {
                patient_id: Number(handover.patient_id),
                receiver_user_id: Number(handover.receiver_user_id),
                sbar: Object.fromEntries(
                  [
                    "situation",
                    "background",
                    "assessment",
                    "recommendation",
                  ].map((k) => [k, handover[k]]),
                ),
                outstanding_task_ids: tasks.rows
                  .filter((t) => t.patient_id === Number(handover.patient_id))
                  .map((t) => t.id),
              });
            }}
          >
            <Field
              label="Handover patient ID"
              required
              value={handover.patient_id}
              onChange={(e) =>
                setHandover({ ...handover, patient_id: e.target.value })
              }
            />
            <Select
              label="Receiving nurse"
              required
              value={handover.receiver_user_id}
              onChange={(e) =>
                setHandover({ ...handover, receiver_user_id: e.target.value })
              }
            >
              <option value="">Choose receiving nurse</option>
              {staff.rows
                .filter((s) => s.role === "nurse" && s.id !== user.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
            {["situation", "background", "assessment", "recommendation"].map(
              (k) => (
                <Field
                  key={k}
                  label={"SBAR " + k}
                  required
                  value={handover[k]}
                  onChange={(e) =>
                    setHandover({ ...handover, [k]: e.target.value })
                  }
                />
              ),
            )}
            <button disabled={command.saving}>Send SBAR handover</button>
          </form>
        </section>
        <ul>
          {handovers.rows.map((h) => (
            <li key={h.id}>
              Patient {h.patient_id}: {h.state} · {h.sbar.situation}
              {h.state === "SENT" && h.receiver_user_id === user.id && (
                <button
                  disabled={command.saving}
                  onClick={() =>
                    command.run(
                      "/handovers/" + h.id + "/acknowledge",
                      {},
                      h.revision,
                    )
                  }
                >
                  Acknowledge responsibility and outstanding tasks
                </button>
              )}
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
