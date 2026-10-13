import { useState } from "react";
import {
  Field,
  SaveStatus,
  useCommand,
  useRows,
} from "../pharmacy/MedicationUI";
export default function MedicationFollowupPanel({ patientId }) {
  const tasks = useRows("/tasks"),
    late = useRows("/late-documentation-requests");
  const command = useCommand(async () => {
    await tasks.refresh();
    await late.refresh();
  });
  const [reasons, setReasons] = useState({});
  return (
    <section className="panel medication-panel" style={{ padding: 16 }}>
      <h2>Medication follow-up and pending documentation review</h2>
      <SaveStatus value={command.status} />
      <SaveStatus value={tasks.state} />
      <ul>
        {tasks.rows
          .filter((t) => !patientId || t.patient_id === Number(patientId))
          .map((t) => (
            <li key={t.id}>
              {t.kind}: {t.detail} — {t.state}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await command.run("/tasks/" + t.id, {
                    state: t.state === "OPEN" ? "ACKNOWLEDGED" : "CLOSED",
                    reason: reasons[t.id],
                  });
                }}
              >
                {t.state === "ACKNOWLEDGED" && (
                  <Field
                    label="Clinical follow-up / closure reason"
                    required
                    value={reasons[t.id] || ""}
                    onChange={(e) =>
                      setReasons({ ...reasons, [t.id]: e.target.value })
                    }
                  />
                )}
                <button disabled={command.saving}>
                  {t.state === "OPEN"
                    ? "Acknowledge assigned task"
                    : "Record clinical action and close"}
                </button>
              </form>
            </li>
          ))}
      </ul>
      <SaveStatus value={late.state} />
      {late.rows
        .filter((r) => !patientId || r.patient_id === Number(patientId))
        .map((r) => (
          <section key={r.id}>
            <h3>
              {r.patient_name} — {r.uhid}
            </h3>
            <p>
              Prior dose of {r.product_snapshot.name}: {r.details.dose}{" "}
              {r.details.dose_unit}, actual time{" "}
              {new Date(r.details.actual_at).toLocaleString()}. {r.reason}
            </p>
            <p>
              Review authorizes documentation of the prior dose only. It cannot
              authorize another dose or a dose after hold/discontinuation.
            </p>
            {r.review_id ? (
              <strong>Prior documentation reviewed</strong>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await command.run(
                    "/late-documentation-requests/" + r.id + "/review",
                    { reason: reasons[r.id] },
                  );
                }}
              >
                <Field
                  label="Prescriber prior-documentation review reason"
                  required
                  value={reasons[r.id] || ""}
                  onChange={(e) =>
                    setReasons({ ...reasons, [r.id]: e.target.value })
                  }
                />
                <button disabled={command.saving}>
                  Authorize exact prior documentation
                </button>
              </form>
            )}
          </section>
        ))}
    </section>
  );
}
