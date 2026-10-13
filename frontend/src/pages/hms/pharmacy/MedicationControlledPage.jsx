import { useState } from "react";
import Navbar from "../../../components/Navbar";
import { useAuth } from "../../../context/AuthContext";
import {
  Field,
  Select,
  SaveStatus,
  MedicationLinks,
  useCommand,
  useRows,
} from "./MedicationUI";
import { WitnessRequest, WitnessInbox } from "./MedicationWitness";
export default function MedicationControlledPage() {
  const { user } = useAuth(),
    products = useRows("/products"),
    locations = useRows("/locations"),
    register = useRows("/controlled/register"),
    cases = useRows("/controlled/discrepancies");
  const command = useCommand(async () => {
    await register.refresh();
    await cases.refresh();
  });
  const [form, setForm] = useState({
      product_id: "",
      batch_id: "",
      location_id: "",
      counted_quantity: "",
      quantity: "",
      shift_ref: "",
      reason: "",
    }),
    [action, setAction] = useState("COUNT"),
    [witness, setWitness] = useState(""),
    [selected, setSelected] = useState(null),
    [investigation, setInvestigation] = useState(""),
    [closure, setClosure] = useState("");
  const edit = (k, v) => {
    setForm({ ...form, [k]: v });
    setWitness("");
  };
  const details =
    action === "COUNT"
      ? {
          product_id: form.product_id,
          batch_id: Number(form.batch_id),
          location_id: form.location_id,
          counted_quantity: form.counted_quantity,
          shift_ref: form.shift_ref,
        }
      : {
          product_id: form.product_id,
          batch_id: Number(form.batch_id),
          location_id: form.location_id,
          quantity: form.quantity,
          reason: form.reason,
        };
  return (
    <>
      <Navbar />
      <MedicationLinks />
      <main className="app-page medication-page">
        <h1>Controlled-drug accountability</h1>
        <p>
          Supply, administration, return and wastage retain authenticated
          independent witness evidence. Count discrepancies require
          investigation; counting never silently changes stock.
        </p>
        <WitnessInbox />
        <SaveStatus value={command.status} />
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            await command.run(
              action === "COUNT" ? "/shift-counts" : "/wastage",
              { ...details, witness_id: witness },
            );
            setWitness("");
          }}
        >
          <Select
            label="Controlled stock action"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setWitness("");
            }}
          >
            <option value="COUNT">Witnessed shift count</option>
            <option value="WASTAGE">Witnessed wastage</option>
          </Select>
          <Select
            label="Controlled product"
            required
            value={form.product_id}
            onChange={(e) => edit("product_id", e.target.value)}
          >
            <option value="">Choose controlled product</option>
            {products.rows
              .filter((p) => p.controlled && p.status === "APPROVED")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
          <Field
            label="Manufacturer batch ID"
            required
            type="number"
            value={form.batch_id}
            onChange={(e) => edit("batch_id", e.target.value)}
          />
          <Select
            label="Count / wastage location"
            required
            value={form.location_id}
            onChange={(e) => edit("location_id", e.target.value)}
          >
            <option value="">Choose stock location</option>
            {locations.rows
              .filter((l) => ["STORE", "WARD"].includes(l.kind))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </Select>
          {action === "COUNT" ? (
            <>
              <Field
                label="Physical counted base quantity"
                required
                value={form.counted_quantity}
                onChange={(e) => edit("counted_quantity", e.target.value)}
              />
              <Field
                label="Shift reference"
                required
                value={form.shift_ref}
                onChange={(e) => edit("shift_ref", e.target.value)}
              />
            </>
          ) : (
            <>
              <Field
                label="Wastage base quantity"
                required
                value={form.quantity}
                onChange={(e) => edit("quantity", e.target.value)}
              />
              <Field
                label="Wastage reason"
                required
                value={form.reason}
                onChange={(e) => edit("reason", e.target.value)}
              />
            </>
          )}
          <WitnessRequest
            action={action}
            subjectId={form.batch_id}
            details={details}
            onAttestation={setWitness}
          />
          <p>
            {witness
              ? "Independent attestation selected"
              : "Independent attestation required"}
          </p>
          <button disabled={!witness || command.saving}>
            Record witnessed {action.toLowerCase()}
          </button>
        </form>
        <h2>Discrepancy cases</h2>
        <SaveStatus value={cases.state} />
        <ul>
          {cases.rows.map((c) => (
            <li key={c.id}>
              Batch {c.batch_id}, shift {c.shift_ref}: expected{" "}
              {c.expected_quantity}, counted {c.counted_quantity} — {c.state}
              {user.role === "pharmacist" && c.state !== "CLOSED" && (
                <button
                  onClick={() => {
                    setSelected(c);
                    setInvestigation(c.investigation || "");
                    setClosure("");
                  }}
                >
                  Investigate case
                </button>
              )}
            </li>
          ))}
        </ul>
        {selected && (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const state = e.nativeEvent.submitter.value;
              const r = await command.run(
                "/controlled/discrepancies/" + selected.id,
                { state, investigation, closure_reason: closure },
              );
              if (r) setSelected(r.state === "CLOSED" ? null : r);
            }}
          >
            <Field
              label="Discrepancy investigation"
              required
              value={investigation}
              onChange={(e) => setInvestigation(e.target.value)}
            />
            <Field
              label="Investigated closure reason"
              value={closure}
              onChange={(e) => setClosure(e.target.value)}
            />
            <button value="INVESTIGATING" disabled={command.saving}>
              Record investigation
            </button>{" "}
            <button
              value="CLOSED"
              disabled={
                selected.state !== "INVESTIGATING" || !closure || command.saving
              }
            >
              Close investigated case
            </button>
          </form>
        )}
        <h2>Controlled-drug register</h2>
        <SaveStatus value={register.state} />
        <table className="mini-table">
          <thead>
            <tr>
              <th>Product / lot</th>
              <th>Event</th>
              <th>Quantity</th>
              <th>Performer / witness</th>
              <th>Recorded</th>
            </tr>
          </thead>
          <tbody>
            {register.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name} / {r.batch_id}
                </td>
                <td>{r.action}</td>
                <td>
                  {r.quantity} {r.unit}
                </td>
                <td>
                  {r.performer_user_id} / {r.witness_user_id}
                </td>
                <td>{new Date(r.recorded_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
