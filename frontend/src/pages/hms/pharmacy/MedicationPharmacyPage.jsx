import { useState } from "react";
import Navbar from "../../../components/Navbar";
import { WitnessRequest } from "./MedicationWitness";
import {
  Field,
  Select,
  SaveStatus,
  Findings,
  MedicationLinks,
  useCommand,
  V2,
  useRows,
} from "./MedicationUI";
export default function MedicationPharmacyPage() {
  const orders = useRows("/orders"),
    locations = useRows("/locations");
  const command = useCommand(orders.refresh);
  const [selected, setSelected] = useState(null),
    [reason, setReason] = useState(""),
    [coverage, setCoverage] = useState(false),
    [overrides, setOverrides] = useState({}),
    [quantity, setQuantity] = useState(""),
    [location, setLocation] = useState(""),
    [witness, setWitness] = useState(""),
    [receipt, setReceipt] = useState(null),
    [returnWitness, setReturnWitness] = useState(""),
    [returnLine, setReturnLine] = useState(""),
    [returnQuantity, setReturnQuantity] = useState(""),
    [returnReason, setReturnReason] = useState("");
  const choose = (row) => {
    setSelected(row);
    setReason("");
    setCoverage(false);
    setOverrides({});
    setQuantity("");
    setWitness("");
    setReceipt(null);
  };
  const review = async (e) => {
    e.preventDefault();
    const saved = await command.run(
      "/medication-orders/" + selected.id + "/verify",
      {
        state: e.nativeEvent.submitter.value,
        reason,
        coverage_acknowledged: coverage,
        overrides: Object.entries(overrides).map(([finding_code, reason]) => ({
          finding_code,
          reason,
        })),
      },
      selected.api_version,
      V2,
    );
    if (saved) setSelected(null);
  };
  const supply = async (e) => {
    e.preventDefault();
    // The supply names the exact order version reviewed; the order's public version is checked.
    const result = await command.run(
      "/dispenses",
      {
        order_id: selected.id,
        order_version_id: selected.version_id,
        product_id: selected.product_id,
        location_id: location,
        quantity: String(quantity),
        ...(witness ? { witness_id: witness } : {}),
      },
      selected.api_version,
      V2,
    );
    if (result) {
      setReceipt(result);
      setQuantity("");
      setSelected(null);
    }
  };
  return (
    <>
      <Navbar />
      <MedicationLinks />
      <main className="app-page medication-page">
        <h1>Pharmacist verification and fulfillment</h1>
        <SaveStatus value={orders.state} />
        <SaveStatus value={command.status} />
        <button type="button" onClick={orders.refresh}>
          Refresh worklist
        </button>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Exact order version</th>
              <th>State / review</th>
              <th>Remaining</th>
              <th>Work</th>
            </tr>
          </thead>
          <tbody>
            {orders.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.patient_name}
                  <br />
                  {r.uhid}
                </td>
                <td>
                  {r.product_snapshot.name || "Ingredient order"}
                  <br />
                  {r.product_snapshot.strength}{" "}
                  {r.product_snapshot.strength_unit} ·{" "}
                  {r.product_snapshot.dose_form} · {r.route}
                  <br />v{r.current_version} · {r.dose} {r.dose_unit}
                </td>
                <td>
                  {r.state} / {r.verification_state || "Not signed"}
                </td>
                <td>
                  {r.remaining} {r.supply_unit}
                </td>
                <td>
                  <button
                    type="button"
                    disabled={command.saving}
                    onClick={() => choose(r)}
                  >
                    Review version {r.current_version}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {selected && (
          <section className="panel" style={{ padding: 16 }}>
            <h2>
              {selected.patient_name} — {selected.uhid}
            </h2>
            <p>
              {selected.product_snapshot.name} · exact version{" "}
              {selected.current_version}, revision {selected.revision}
            </p>
            <Findings
              findings={selected.findings || []}
              coverage={selected.coverage || {}}
            />
            {selected.state === "SIGNED" &&
              selected.verification_state !== "VERIFIED" && (
                <form onSubmit={review} className="stack">
                  <Field
                    label="Pharmacist review / clarification reason"
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={coverage}
                      onChange={(e) => setCoverage(e.target.checked)}
                    />{" "}
                    I reviewed declared coverage, missing context and requested
                    overrides.
                  </label>
                  {(selected.findings || [])
                    .filter((f) => f.severity === "BLOCK")
                    .map((f) => (
                      <Field
                        key={f.code}
                        label={"Approved override reason: " + f.code}
                        value={overrides[f.code] || ""}
                        onChange={(e) =>
                          setOverrides({
                            ...overrides,
                            [f.code]: e.target.value,
                          })
                        }
                      />
                    ))}
                  <div>
                    <button
                      value="VERIFIED"
                      disabled={command.saving}
                      className="btn btn-primary"
                    >
                      Verify exact version
                    </button>{" "}
                    <button value="CLARIFICATION" disabled={command.saving}>
                      Request clarification
                    </button>
                  </div>
                </form>
              )}
            {selected.state === "SIGNED" &&
              selected.verification_state === "VERIFIED" && (
                <form onSubmit={supply} className="stack">
                  <p>
                    FEFO allocation uses only available, unexpired stock.
                    Product identity, strength, form and route are retained in
                    the order snapshot.
                  </p>
                  <Select
                    label="Supply location"
                    required
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  >
                    <option value="">Select location</option>
                    {locations.rows
                      .filter((l) => ["STORE", "WARD"].includes(l.kind))
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </Select>
                  <Field
                    label="Quantity to supply (base units)"
                    required
                    inputMode="decimal"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                  {selected.product_snapshot.controlled && (
                    <>
                      <WitnessRequest
                        action="SUPPLY"
                        subjectId={selected.version_id}
                        details={{
                          product_id: selected.product_id,
                          location_id: location,
                          quantity,
                        }}
                        onAttestation={setWitness}
                      />
                      <Field
                        label="Authenticated witness attestation ID"
                        required
                        value={witness}
                        onChange={(e) => setWitness(e.target.value)}
                      />
                    </>
                  )}
                  <button className="btn btn-primary" disabled={command.saving}>
                    Confirm partial supply
                  </button>
                </form>
              )}
          </section>
        )}
        {receipt && (
          <section role="status">
            <h2>Confirmed supply</h2>
            <p>
              {orders.rows.some((o) => o.id === receipt.order_id)
                ? `${orders.rows.find((o) => o.id === receipt.order_id).remaining} base units remain authorized.`
                : "The order is fully supplied or no longer listed."}{" "}
              Each listed line
              has its stock movement and charge.
            </p>
            <ul>
              {receipt.lines.map((l) => (
                <li key={l.id}>
                  Lot {l.batch_id}: {l.quantity} {l.unit}, charge ₹{l.amount};
                  supply line {l.id}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="panel" style={{ padding: 16 }}>
          <h2>Return supplied stock to quarantine</h2>
          <p>
            The financial credit is referred separately; a return never makes
            the medicine available for picking.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await command.run("/returns/" + returnLine, {
                quantity: returnQuantity,
                reason: returnReason,
                ...(returnWitness ? { witness_id: returnWitness } : {}),
              });
              if (r) {
                setReturnQuantity("");
                setReturnReason("");
              }
            }}
            className="stack"
          >
            <Field
              label="Supplied line ID"
              required
              value={returnLine}
              onChange={(e) => setReturnLine(e.target.value)}
            />
            <Field
              label="Return quantity"
              required
              value={returnQuantity}
              onChange={(e) => setReturnQuantity(e.target.value)}
            />
            <Field
              label="Return reason"
              required
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
            />
            {returnLine && (
              <WitnessRequest
                action="RETURN"
                subjectId={returnLine}
                details={{ quantity: returnQuantity, reason: returnReason }}
                onAttestation={setReturnWitness}
              />
            )}
            <button disabled={command.saving}>Receive into quarantine</button>
          </form>
        </section>
      </main>
    </>
  );
}
