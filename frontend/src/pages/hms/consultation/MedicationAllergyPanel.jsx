import { useState } from "react";
import {
  Field,
  Select,
  SaveStatus,
  useCommand,
  useRows,
} from "../pharmacy/MedicationUI";
export default function MedicationAllergyPanel({ patientId }) {
  const record = useRows("/allergies/" + patientId),
    ingredients = useRows("/ingredients");
  const command = useCommand(record.refresh);
  const [state, setState] = useState("UNKNOWN"),
    [reason, setReason] = useState(""),
    [form, setForm] = useState({
      ingredient_id: "",
      clinical_text: "",
      reaction: "",
      clinical_status: "ACTIVE",
      verification_status: "UNCONFIRMED",
    });
  const data =
    record.rows &&
    typeof record.rows === "object" &&
    !Array.isArray(record.rows)
      ? record.rows
      : null;
  return (
    <section
      className="panel medication-panel"
      aria-label="Governed allergy review"
      style={{ padding: 16 }}
    >
      <h2>Allergy review</h2>
      <SaveStatus value={record.state} />
      <SaveStatus value={command.status} />
      <p>
        <strong>{data?.review_state || "Unknown / not reviewed"}</strong>. An
        empty list never establishes none known. A new review can invalidate
        prior medication verification.
      </p>
      <ul>
        {[
          ...(data?.allergies || []).map((a) => ({
            ...a,
            label: a.clinical_text,
          })),
          ...(data?.legacy_allergies || []).map((a) => ({
            ...a,
            label: a.allergen,
          })),
        ].map((a) => (
          <li key={a.id}>
            {a.label}: {a.reaction || "Reaction not recorded"}{" "}
            {a.ingredient_id ? "(coded)" : "(coding incomplete)"}
          </li>
        ))}
      </ul>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          await command.run(
            "/allergies/" + patientId + "/review",
            { state, reason },
            data?.revision ?? 0,
          );
        }}
      >
        <Select
          label="Explicit allergy review state"
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          {["UNKNOWN", "NOT_REVIEWED", "NONE_KNOWN", "ALLERGIES_RECORDED"].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </Select>
        <Field
          label="Allergy review reason / source"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button disabled={command.saving}>Confirm allergy review</button>
      </form>
      <details>
        <summary>Record an allergy intolerance</summary>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const b = {
              ...form,
              ...(form.ingredient_id ? {} : { ingredient_id: null }),
            };
            if (await command.run("/allergies/" + patientId, b))
              setForm({ ...form, clinical_text: "", reaction: "" });
          }}
        >
          <Select
            label="Coded substance where known"
            value={form.ingredient_id}
            onChange={(e) =>
              setForm({ ...form, ingredient_id: e.target.value })
            }
          >
            <option value="">Uncoded — review remains incomplete</option>
            {ingredients.rows.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
          <Field
            label="Clinician allergy text"
            required
            value={form.clinical_text}
            onChange={(e) =>
              setForm({ ...form, clinical_text: e.target.value })
            }
          />
          <Field
            label="Observed allergy reaction"
            required
            value={form.reaction}
            onChange={(e) => setForm({ ...form, reaction: e.target.value })}
          />
          <Select
            label="Allergy clinical status"
            value={form.clinical_status}
            onChange={(e) =>
              setForm({ ...form, clinical_status: e.target.value })
            }
          >
            {["ACTIVE", "INACTIVE", "RESOLVED"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <Select
            label="Allergy verification status"
            value={form.verification_status}
            onChange={(e) =>
              setForm({ ...form, verification_status: e.target.value })
            }
          >
            {["UNCONFIRMED", "CONFIRMED", "REFUTED", "ENTERED_IN_ERROR"].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </Select>
          <button disabled={command.saving}>
            Save attributable allergy record
          </button>
        </form>
      </details>
    </section>
  );
}
