import { useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import Navbar from "../../../components/Navbar";
import { WitnessRequest } from "./MedicationWitness";
import {
  Field,
  Select,
  SaveStatus,
  MedicationLinks,
  useCommand,
  useRows,
} from "./MedicationUI";
export default function MedicationStockPage() {
  const { user } = useAuth();
  const stock = useRows("/stock"),
    locations = useRows("/locations"),
    products = useRows("/products"),
    requests = useRows("/requisitions");
  const command = useCommand(async () => {
    await stock.refresh();
    await requests.refresh();
  });
  const [form, setForm] = useState({
      product_id: "",
      destination_id: "",
      quantity: "",
      reason: "",
    }),
    [lot, setLot] = useState(null),
    [lotReason, setLotReason] = useState(""),
    [lotDocument, setLotDocument] = useState(""),
    [status, setStatus] = useState("QUARANTINED");
  const [receipt, setReceipt] = useState({
    supplier_id: "",
    invoice_ref: "",
    product_id: "",
    manufacturer_lot: "",
    manufacturer: "",
    document_ref: "",
    expiry_date: "",
    quantity: "",
    purchase_rate: "",
    mrp: "",
  });
  const [transfer, setTransfer] = useState(null);
  const [transferWitness, setTransferWitness] = useState("");
  const edit = (k, v) => setReceipt((f) => ({ ...f, [k]: v }));
  return (
    <>
      <Navbar />
      <MedicationLinks />
      <main className="app-page medication-page">
        <h1>Location stock and ward supply</h1>
        <SaveStatus value={stock.state} />
        <SaveStatus value={command.status} />
        <button onClick={stock.refresh}>Refresh stock</button>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Product / lot</th>
              <th>Location</th>
              <th>Disposition / expiry</th>
              <th>Base units</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {stock.rows.map((r) => (
              <tr key={r.batch_id + ":" + r.location_id}>
                <td>
                  {r.name || "Legacy identity requiring review"}
                  <br />
                  {r.batch_number}
                </td>
                <td>
                  {r.location_name} ({r.kind})
                </td>
                <td>
                  {r.effective_lot_status || r.lot_status} ·{" "}
                  {new Date(r.expiry_date).toLocaleDateString()}
                </td>
                <td>
                  {r.quantity} {r.base_unit}
                </td>
                <td>
                  {user?.role === "pharmacist" && (
                    <button
                      onClick={() => {
                        setLot(r);
                        setLotReason("");
                        setLotDocument(r.provenance?.document_ref || "");
                      }}
                    >
                      Disposition
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lot && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await command.run("/stock/" + lot.batch_id + "/status", {
                  status,
                  reason: lotReason,
                  ...(lotDocument ? { document_ref: lotDocument } : {}),
                })
              )
                setLot(null);
            }}
          >
            <h2>Lot {lot.batch_number}</h2>
            <Select
              label="Lot disposition"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {["AVAILABLE", "QUARANTINED", "RECALLED", "EXPIRED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
            <Field
              label="Disposition reason"
              required
              value={lotReason}
              onChange={(e) => setLotReason(e.target.value)}
            />
            {status === "AVAILABLE" && (
              <Field
                label="Verified manufacturer lot and expiry source document"
                required
                value={lotDocument}
                onChange={(e) => setLotDocument(e.target.value)}
              />
            )}
            <button disabled={command.saving}>Confirm disposition</button>
          </form>
        )}
        {user?.role === "pharmacist" && (
          <section className="panel" style={{ padding: 16 }}>
            <h2>Receive a manufacturer lot</h2>
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const { supplier_id, invoice_ref, product_id, ...line } =
                  receipt;
                const r = await command.run("/receipts", {
                  supplier_id: Number(supplier_id),
                  invoice_ref,
                  lines: [{ ...line, product_id }],
                });
                if (r)
                  setReceipt({
                    ...receipt,
                    invoice_ref: "",
                    manufacturer_lot: "",
                    quantity: "",
                  });
              }}
            >
              <div className="form-grid">
                {[
                  ["supplier_id", "Supplier ID"],
                  ["invoice_ref", "Supplier invoice reference"],
                  ["manufacturer_lot", "Manufacturer lot"],
                  ["manufacturer", "Manufacturer"],
                  ["document_ref", "Provenance document reference"],
                  ["expiry_date", "Manufacturer expiry date"],
                  ["quantity", "Receipt base quantity"],
                  ["purchase_rate", "Purchase rate per base unit"],
                  ["mrp", "Price per base unit"],
                ].map(([k, label]) => (
                  <Field
                    key={k}
                    label={label}
                    required
                    type={k === "expiry_date" ? "date" : "text"}
                    value={receipt[k]}
                    onChange={(e) => edit(k, e.target.value)}
                  />
                ))}
              </div>
              <Select
                label="Receipt approved product"
                required
                value={receipt.product_id}
                onChange={(e) => edit("product_id", e.target.value)}
              >
                <option value="">Choose identity</option>
                {products.rows
                  .filter((p) => p.status === "APPROVED")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.base_unit}
                    </option>
                  ))}
              </Select>
              <button disabled={command.saving}>Confirm receipt</button>
            </form>
          </section>
        )}
        {user?.role === "nurse" && (
          <section className="panel" style={{ padding: 16 }}>
            <h2>Request ward supply</h2>
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await command.run("/requisitions", form))
                  setForm({ ...form, quantity: "", reason: "" });
              }}
            >
              <Select
                label="Requisition product"
                required
                value={form.product_id}
                onChange={(e) =>
                  setForm({ ...form, product_id: e.target.value })
                }
              >
                <option value="">Choose product</option>
                {products.rows
                  .filter((p) => p.status === "APPROVED")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
              <Select
                label="Receiving ward location"
                required
                value={form.destination_id}
                onChange={(e) =>
                  setForm({ ...form, destination_id: e.target.value })
                }
              >
                <option value="">Choose ward</option>
                {locations.rows
                  .filter((l) => l.kind === "WARD")
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </Select>
              <Field
                label="Requisition base quantity"
                required
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
              <Field
                label="Requisition reason"
                required
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
              <button disabled={command.saving}>Send requisition</button>
            </form>
          </section>
        )}
        {transfer && (
          <section className="panel">
            <h2>Witness controlled ward transfer</h2>
            <p>
              {transfer.product_name} · {transfer.quantity} base units to{" "}
              {transfer.destination_name}
            </p>
            <WitnessRequest
              action="TRANSFER"
              subjectId={transfer.id}
              details={{
                product_id: transfer.product_id,
                destination_id: transfer.destination_id,
                quantity: transfer.quantity,
              }}
              onAttestation={setTransferWitness}
            />
            <p>
              The witness reviews this approved requisition; picking retains its
              exact product, quantity and destination.
            </p>
            <button
              disabled={!transferWitness || command.saving}
              onClick={async () => {
                const saved = await command.run(
                  "/requisitions/" + transfer.id + "/pick",
                  {
                    product_id: transfer.product_id,
                    destination_id: transfer.destination_id,
                    quantity: transfer.quantity,
                    witness_id: transferWitness,
                  },
                  transfer.revision,
                );
                if (saved) setTransfer(null);
              }}
            >
              Confirm witnessed pick
            </button>
            <button onClick={() => setTransfer(null)}>Cancel</button>
          </section>
        )}
        <h2>Transfers</h2>
        <p>
          Picked quantities remain in transit until the requesting nurse
          acknowledges receipt.
        </p>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Product / ward</th>
              <th>State</th>
              <th>Quantity</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {requests.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.product_name} / {r.destination_name}
                </td>
                <td>{r.state}</td>
                <td>{r.quantity}</td>
                <td>
                  {user?.role === "pharmacist" && r.state === "REQUESTED" && (
                    <button
                      disabled={command.saving}
                      onClick={() =>
                        command.run(
                          "/requisitions/" + r.id + "/approve",
                          {},
                          r.revision,
                        )
                      }
                    >
                      Approve
                    </button>
                  )}
                  {user?.role === "pharmacist" && r.state === "APPROVED" && (
                    <button
                      disabled={command.saving}
                      onClick={() => {
                        const controlled = products.rows.find(
                          (p) => p.id === r.product_id,
                        )?.controlled;
                        if (controlled) {
                          setTransfer(r);
                          setTransferWitness("");
                        } else
                          command.run(
                            "/requisitions/" + r.id + "/pick",
                            {},
                            r.revision,
                          );
                      }}
                    >
                      Pick into transit
                    </button>
                  )}
                  {user?.role === "nurse" &&
                    r.state === "PICKED" &&
                    r.requested_by_user_id === user.id && (
                      <button
                        disabled={command.saving}
                        onClick={() =>
                          command.run(
                            "/requisitions/" + r.id + "/receive",
                            {},
                            r.revision,
                          )
                        }
                      >
                        Acknowledge physical receipt
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
