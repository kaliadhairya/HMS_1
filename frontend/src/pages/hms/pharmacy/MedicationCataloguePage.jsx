import { useState } from "react";
import Navbar from "../../../components/Navbar";
import {
  Field,
  Select,
  SaveStatus,
  MedicationLinks,
  useCommand,
  useRows,
  iso,
} from "./MedicationUI";
export default function MedicationCataloguePage() {
  const products = useRows("/products"),
    ingredients = useRows("/ingredients"),
    queue = useRows("/reconciliation"),
    packs = useRows("/rule-packs");
  const command = useCommand(async () => {
    await products.refresh();
    await ingredients.refresh();
    await queue.refresh();
    await packs.refresh();
  });
  const [ingredient, setIngredient] = useState({
    code_system: "",
    code: "",
    name: "",
    provenance: "",
    effective_at: "",
  });
  const [product, setProduct] = useState({
    code: "",
    name: "",
    strength: "",
    strength_unit: "",
    dose_form: "",
    route: "",
    base_unit: "",
    pack_unit: "",
    pack_conversion: "",
    quantity_precision: "",
    barcode: "",
    provenance: "",
    effective_at: "",
    controlled: false,
    concentration_denominator: "",
    concentration_unit: "",
  });
  const [composition, setComposition] = useState([
    { ingredient_id: "", amount: "", unit: "" },
  ]);
  const [counterPermitted, setCounterPermitted] = useState(false);
  const [legacyId, setLegacyId] = useState(null);
  const [pack, setPack] = useState({
    code: "",
    revision: "",
    provenance: "",
    effective_at: "",
    content: "",
    coverage: "",
  });
  return (
    <>
      <Navbar />
      <MedicationLinks />
      <main className="app-page medication-page">
        <h1>Governed medication catalogue</h1>
        <p>
          Clinical rules and dose limits ship empty. Only reviewed content with
          provenance and an effective date can be published. A display name
          never substitutes for coded identity.
        </p>
        <SaveStatus value={command.status} />
        <details>
          <summary>Add coded ingredient</summary>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await command.run("/ingredients", {
                  ...ingredient,
                  effective_at: iso(ingredient.effective_at),
                })
              )
                setIngredient({ ...ingredient, code: "", name: "" });
            }}
          >
            {Object.keys(ingredient).map((k) => (
              <Field
                key={k}
                label={"Ingredient " + k.replaceAll("_", " ")}
                required
                type={k === "effective_at" ? "datetime-local" : "text"}
                value={ingredient[k]}
                onChange={(e) =>
                  setIngredient({ ...ingredient, [k]: e.target.value })
                }
              />
            ))}
            <button disabled={command.saving}>Save reviewed ingredient</button>
          </form>
        </details>
        <details>
          <summary>Add approved medication product</summary>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const saved = await command.run(
                legacyId ? "/products/" + legacyId + "/approve" : "/products",
                {
                  ...product,
                  quantity_precision: Number(product.quantity_precision),
                  effective_at: iso(product.effective_at),
                  ingredients: composition,
                  restrictions: { otc_allowed: counterPermitted },
                },
              );
              if (saved) {
                setLegacyId(null);
                setCounterPermitted(false);
                setProduct(
                  Object.fromEntries(
                    Object.keys(product).map((k) => [
                      k,
                      k === "controlled" ? false : "",
                    ]),
                  ),
                );
                setComposition([{ ingredient_id: "", amount: "", unit: "" }]);
              }
            }}
          >
            <div className="form-grid">
              {Object.keys(product)
                .filter((k) => k !== "controlled")
                .map((k) => (
                  <Field
                    key={k}
                    label={"Product " + k.replaceAll("_", " ")}
                    required={
                      k !== "barcode" &&
                      (![
                        "concentration_denominator",
                        "concentration_unit",
                      ].includes(k) ||
                        product.strength_unit !== product.base_unit)
                    }
                    type={k === "effective_at" ? "datetime-local" : "text"}
                    value={product[k]}
                    onChange={(e) =>
                      setProduct({ ...product, [k]: e.target.value })
                    }
                  />
                ))}
            </div>
            <label>
              <input
                type="checkbox"
                checked={product.controlled}
                onChange={(e) =>
                  setProduct({ ...product, controlled: e.target.checked })
                }
              />{" "}
              Controlled product: witnessed supply and administration
            </label>
            <label>
              <input
                type="checkbox"
                checked={counterPermitted}
                onChange={(e) => setCounterPermitted(e.target.checked)}
              />{" "}
              Explicit approved permission for sale without a prescription
              (include its authority in provenance)
            </label>
            <h3>Approved composition</h3>
            {composition.map((c, index) => (
              <div className="form-grid" key={index}>
                <Select
                  label={"Ingredient " + (index + 1)}
                  required
                  value={c.ingredient_id}
                  onChange={(e) =>
                    setComposition(
                      composition.map((x, i) =>
                        i === index
                          ? { ...x, ingredient_id: e.target.value }
                          : x,
                      ),
                    )
                  }
                >
                  <option value="">Choose coded ingredient</option>
                  {ingredients.rows.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.code_system}: {i.code})
                    </option>
                  ))}
                </Select>
                <Field
                  label={"Composition amount " + (index + 1)}
                  required
                  value={c.amount}
                  onChange={(e) =>
                    setComposition(
                      composition.map((x, i) =>
                        i === index ? { ...x, amount: e.target.value } : x,
                      ),
                    )
                  }
                />
                <Field
                  label={"Composition unit " + (index + 1)}
                  required
                  value={c.unit}
                  onChange={(e) =>
                    setComposition(
                      composition.map((x, i) =>
                        i === index ? { ...x, unit: e.target.value } : x,
                      ),
                    )
                  }
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setComposition([
                  ...composition,
                  { ingredient_id: "", amount: "", unit: "" },
                ])
              }
            >
              Add composition ingredient
            </button>
            <button disabled={command.saving}>
              Publish approved identity and formulary entry
            </button>
          </form>
        </details>
        <details>
          <summary>Publish externally reviewed clinical rule pack</summary>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await command.run("/rule-packs", {
                  ...pack,
                  revision: Number(pack.revision),
                  effective_at: iso(pack.effective_at),
                  content: JSON.parse(pack.content),
                  coverage: JSON.parse(pack.coverage),
                });
              } catch {
                command.setStatus({
                  kind: "failed",
                  message:
                    "Content and coverage must be valid structured rule-pack documents.",
                });
              }
            }}
          >
            {["code", "revision", "provenance", "effective_at"].map((k) => (
              <Field
                key={k}
                label={"Rule pack " + k.replaceAll("_", " ")}
                required
                type={k === "effective_at" ? "datetime-local" : "text"}
                value={pack[k]}
                onChange={(e) => setPack({ ...pack, [k]: e.target.value })}
              />
            ))}
            <Field label="Approved content document">
              <textarea
                className="form-input"
                required
                rows="8"
                value={pack.content}
                onChange={(e) => setPack({ ...pack, content: e.target.value })}
              />
            </Field>
            <Field label="Declared coverage document">
              <textarea
                className="form-input"
                required
                rows="5"
                value={pack.coverage}
                onChange={(e) => setPack({ ...pack, coverage: e.target.value })}
              />
            </Field>
            <button disabled={command.saving}>
              Publish immutable reviewed rule revision
            </button>
          </form>
        </details>
        <h2>Medication identities</h2>
        <SaveStatus value={products.state} />
        <table className="mini-table">
          <thead>
            <tr>
              <th>Identity</th>
              <th>Strength / form / route</th>
              <th>Base / pack conversion</th>
              <th>Approval</th>
            </tr>
          </thead>
          <tbody>
            {products.rows.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.name} / {p.code}
                </td>
                <td>
                  {p.strength || "Unreviewed"} {p.strength_unit} · {p.dose_form}{" "}
                  · {p.route || "Unreviewed"}
                </td>
                <td>
                  {p.base_unit || "Unreviewed"} /{" "}
                  {p.pack_conversion || "Unreviewed"} {p.pack_unit}
                </td>
                <td>
                  {p.status}
                  {p.status === "DRAFT" && (
                    <button
                      type="button"
                      onClick={() => {
                        setLegacyId(p.id);
                        setCounterPermitted(false);
                        setComposition([
                          { ingredient_id: "", amount: "", unit: "" },
                        ]);
                        setProduct({
                          ...Object.fromEntries(
                            Object.keys(product).map((k) => [k, ""]),
                          ),
                          code: p.code,
                          name: p.name,
                          strength: p.strength || "",
                          strength_unit: p.strength_unit || "",
                          dose_form: p.dose_form || "",
                          controlled: p.controlled,
                          pack_unit: p.pack_unit || "",
                        });
                      }}
                    >
                      Reconcile this legacy identity
                    </button>
                  )}
                  {p.status === "APPROVED" && (
                    <button
                      type="button"
                      onClick={() => {
                        const reason = window.prompt(
                          "Retirement reason; historical orders remain intact",
                        );
                        if (reason)
                          command.run("/products/" + p.id + "/retire", {
                            reason,
                          });
                      }}
                    >
                      Retire future use
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Legacy reconciliation</h2>
        <p>
          Ambiguous free-text lines remain readable and cannot authorize supply.
        </p>
        <ul>
          {queue.rows.map((r) => (
            <li key={r.id}>
              Legacy medicine {r.legacy_medicine_id || "—"}, line{" "}
              {r.legacy_item_id || "—"}: {r.reason}
            </li>
          ))}
        </ul>
        <h2>Rule revisions</h2>
        {!packs.rows.length ? (
          <p>Check unavailable: no approved rule packs configured.</p>
        ) : (
          <ul>
            {packs.rows.map((p) => (
              <li key={p.id}>
                {p.code} v{p.revision} — {p.provenance}; effective{" "}
                {new Date(p.effective_at).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
