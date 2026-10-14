import { useEffect, useState } from "react";
import api from "../../../api/axios";
export default function LaboratoryReconciliation({
  orders,
  catalogue,
  command,
}) {
  const [rows, setRows] = useState([]),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(null),
    [test, setTest] = useState(""),
    [itemId, setItemId] = useState(""),
    [patient, setPatient] = useState(""),
    [specimen, setSpecimen] = useState(""),
    [accession, setAccession] = useState(""),
    [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false);
  const items = orders.flatMap((o) =>
    o.items.map((i) => ({
      ...i,
      patient_id: o.patient_id,
      patient_name: o.patient_name,
    })),
  );
  async function refresh() {
    try {
      setRows((await api.get("/laboratory/reconciliation")).data.data);
      setError("");
    } catch (e) {
      setError(
        e.response?.data?.message || "Reconciliation observations unavailable.",
      );
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  const legacy = selected?.item_id != null,
    chosen = items.find(
      (i) => i.id === Number(legacy ? selected?.item_id : itemId),
    ),
    disabled = command.busy || command.uncertain;
  return (
    <section className="panel" style={{ padding: 16 }}>
      <h2>Identity and message reconciliation</h2>
      <p>
        Original evidence is retained. Link a historical test only after
        reviewing the approved catalogue identity. Confirm an unmatched analyzer
        message against the actual patient, order and specimen label.
      </p>
      <button className="btn btn-ghost" onClick={refresh}>
        Refresh reconciliation
      </button>
      {error && <p role="alert">{error}</p>}
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <button
              className="btn btn-ghost"
              disabled={disabled}
              onClick={() => {
                setSelected(r);
                setReviewed(false);
                setReason("");
              }}
            >
              {r.source} ·{" "}
              {r.item_id ? "Test item " + r.item_id : "Message " + r.message_id}{" "}
              · {r.reason}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!chosen) return;
            const outcome = await command.send(
              legacy
                ? "/items/" + selected.item_id + "/reconcile"
                : "/reconciliation/" + selected.id + "/resolve",
              legacy
                ? { test_version_id: test, reason }
                : {
                    item_id: chosen.id,
                    patient_id: Number(patient),
                    specimen_id: specimen,
                    accession,
                    reason,
                  },
              chosen.lab_revision,
            );
            if (outcome) {
              setSelected(null);
              await refresh();
            }
          }}
        >
          <p>{selected.reason}</p>
          {selected.payload?.contract && (
            <details>
              <summary>Original analyzer evidence</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(selected.payload.contract, null, 2)}
              </pre>
            </details>
          )}
          {legacy ? (
            <label className="form-group">
              Approved catalogue test
              <select
                required
                className="form-input"
                value={test}
                onChange={(e) => setTest(e.target.value)}
              >
                <option value="">Select reviewed test version</option>
                {catalogue
                  .filter((t) => t.kind === "TEST")
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} · {t.name} · version {t.version}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <>
              <label className="form-group">
                Matching ordered test
                <select
                  required
                  className="form-input"
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                >
                  <option value="">Select ordered item</option>
                  {items
                    .filter((i) => i.lab_test_version_id)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.patient_name} · item {i.id} · {i.item_name}
                      </option>
                    ))}
                </select>
              </label>
              {[
                ["Confirmed patient identifier", patient, setPatient],
                ["Confirmed specimen identifier", specimen, setSpecimen],
                ["Confirmed specimen accession", accession, setAccession],
              ].map(([label, v, set]) => (
                <label key={label} className="form-group">
                  {label}
                  <input
                    required
                    className="form-input"
                    value={v}
                    onChange={(e) => set(e.target.value)}
                  />
                </label>
              ))}
            </>
          )}
          <label className="form-group">
            Reconciliation evidence
            <input
              required
              className="form-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed the identity and source evidence against the chart and
            specimen label
          </label>
          <button
            className="btn btn-primary"
            disabled={disabled || !reviewed || !chosen}
          >
            Apply reviewed reconciliation
          </button>
        </form>
      )}
    </section>
  );
}
