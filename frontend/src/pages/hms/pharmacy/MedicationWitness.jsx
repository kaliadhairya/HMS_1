import { useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { Field, Select, SaveStatus, useCommand, useRows } from "./MedicationUI";
export function WitnessRequest({ action, subjectId, details, onAttestation }) {
  const { user } = useAuth(),
    staff = useRows("/staff"),
    requests = useRows("/witness-requests");
  const command = useCommand(requests.refresh);
  const [recipient, setRecipient] = useState("");
  const matching = requests.rows.filter(
    (r) =>
      r.performer_user_id === user.id &&
      r.action === action &&
      r.subject_id === String(subjectId),
  );
  return (
    <section aria-label="Independent witness">
      <h3>Independent witness</h3>
      <p>
        Ask another authorized clinician to review this exact proposed action.
        An attestation cannot be reused for different quantities, products or
        times.
      </p>
      <Select
        label="Requested witness"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
      >
        <option value="">Choose independent clinician</option>
        {staff.rows
          .filter((s) => s.id !== user.id)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.role})
            </option>
          ))}
      </Select>
      <button
        type="button"
        disabled={!recipient || command.saving}
        onClick={() =>
          command.run("/witness-requests", {
            action,
            subject_id: String(subjectId),
            details,
            requested_witness_user_id: Number(recipient),
          })
        }
      >
        Request independent attestation
      </button>
      <button type="button" onClick={requests.refresh}>
        Refresh witness response
      </button>
      <SaveStatus value={command.status} />
      <ul>
        {matching.map((r) => (
          <li key={r.id}>
            {r.witness_name}: {r.state}
            {r.witness_id && (
              <button type="button" onClick={() => onAttestation(r.witness_id)}>
                Use this signed attestation
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
function Detail({ value, prefix = "", products = [], locations = [] }) {
  return (
    <dl>
      {Object.entries(value || {})
        .filter(([k]) => k !== "witness_id")
        .map(([k, v]) => (
          <div key={k}>
            <dt>
              <strong>{prefix + k.replaceAll("_", " ")}</strong>
            </dt>
            <dd>
              {v && typeof v === "object" ? (
                <Detail value={v} products={products} locations={locations} />
              ) : ["product_id"].includes(k) &&
                products.some((p) => p.id === v) ? (
                (() => {
                  const p = products.find((p) => p.id === v);
                  return `${p.name} · ${p.strength} ${p.strength_unit} · ${p.dose_form} · ${p.route} (${v})`;
                })()
              ) : ["location_id", "destination_id"].includes(k) &&
                locations.some((l) => l.id === v) ? (
                `${locations.find((l) => l.id === v).name} (${v})`
              ) : (
                String(v ?? "—")
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}
export function WitnessInbox() {
  const { user } = useAuth(),
    requests = useRows("/witness-requests"),
    products = useRows("/products"),
    locations = useRows("/locations");
  const command = useCommand(requests.refresh);
  const [reasons, setReasons] = useState({});
  return (
    <section>
      <h2>Witness requests for you</h2>
      <SaveStatus value={requests.state} />
      <SaveStatus value={command.status} />
      <button onClick={requests.refresh}>Refresh requests</button>
      {requests.rows
        .filter((r) => r.requested_witness_user_id === user.id)
        .map((r) => (
          <section
            className="panel"
            style={{ padding: 16, marginBottom: 12 }}
            key={r.id}
          >
            <h3>
              {r.action} by {r.performer_name} — {r.state}
            </h3>
            <p>Subject {r.subject_id}</p>
            <Detail
              value={r.details}
              products={products.rows}
              locations={locations.rows}
            />
            {r.state === "PENDING" && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await command.run("/witness-requests/" + r.id + "/attest", {
                    reason: reasons[r.id],
                  });
                }}
              >
                <Field
                  label="Independent witness statement"
                  required
                  value={reasons[r.id] || ""}
                  onChange={(e) =>
                    setReasons({ ...reasons, [r.id]: e.target.value })
                  }
                />
                <button disabled={command.saving}>
                  Attest reviewed action
                </button>
              </form>
            )}
          </section>
        ))}
    </section>
  );
}
