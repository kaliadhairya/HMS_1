import { cloneElement, useCallback, useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Barcode from "react-barcode";
import api from "../../../api/axios";
import Navbar from "../../../components/Navbar";
import PageHeader from "../../../components/ui/PageHeader";
import { useAuth } from "../../../context/AuthContext";
import { useLaboratoryCommand } from "./laboratoryCommand";
import LaboratoryReconciliation from "./LaboratoryReconciliation";
const value = (e) => e.target.value;
function Field({ label, children }) {
  const id = useId();
  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      {cloneElement(children, { id })}
    </div>
  );
}
export default function LaboratoryWorkspace({ initialTab = "orders" }) {
  const { user } = useAuth(),
    [params] = useSearchParams();
  const [tab, setTab] = useState(initialTab),
    [orders, setOrders] = useState([]),
    [catalogue, setCatalogue] = useState([]),
    [tasks, setTasks] = useState([]),
    [reviews, setReviews] = useState([]),
    [recollections, setRecollections] = useState([]),
    [privileges, setPrivileges] = useState([]),
    [qc, setQC] = useState([]),
    [qcRules, setQCRules] = useState([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [observed, setObserved] = useState(null),
    [selectedId, setSelectedId] = useState(null),
    [draft, setDraft] = useState(null),
    [checked, setChecked] = useState(false),
    [reportSelection, setReportSelection] = useState([]),
    [reportStatus, setReportStatus] = useState("FINAL"),
    [reportReason, setReportReason] = useState(""),
    [snapshot, setSnapshot] = useState(null);
  const [patientId, setPatientId] = useState(params.get("patient_id") || ""),
    [encounterId, setEncounterId] = useState(""),
    [testIds, setTestIds] = useState([]),
    [priority, setPriority] = useState("Routine");
  const [specimenRequirement, setSpecimenRequirement] = useState(""),
    [specimenItems, setSpecimenItems] = useState([]),
    [location, setLocation] = useState(""),
    [confirmedPatient, setConfirmedPatient] = useState(""),
    [scannedAccession, setScannedAccession] = useState(""),
    [custodyReason, setCustodyReason] = useState(""),
    [selectedSpecimen, setSelectedSpecimen] = useState(null),
    [parentId, setParentId] = useState("");
  const [configurationKind, setConfigurationKind] = useState("reference"),
    [configurationText, setConfigurationText] = useState(""),
    [configError, setConfigError] = useState(""),
    [catalogueText, setCatalogueText] = useState(""),
    [qcRule, setQCRule] = useState(""),
    [qcStatus, setQCStatus] = useState("PASS"),
    [qcEvidence, setQCEvidence] = useState(""),
    [qcRun, setQCRun] = useState(""),
    [taskAction, setTaskAction] = useState(""),
    [contact, setContact] = useState({
      recipient: "",
      channel: "",
      outcome: "CONTACTED",
      evidence: "",
    });
  const clinical = user?.role === "doctor",
    laboratory = user?.role === "lab_technician",
    collector = laboratory || user?.role === "nurse",
    admin = ["admin", "super_admin"].includes(user?.role);
  const [grant, setGrant] = useState({
    user_id: "",
    privilege: "TECHNICAL_REVIEW",
    reason: "",
    valid_from: "",
    valid_until: "",
  });
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const queries = [
        api.get(
          "/laboratory/worklist" +
            (params.get("patient_id")
              ? "?patient_id=" + encodeURIComponent(params.get("patient_id"))
              : ""),
        ),
        api.get("/laboratory/catalogue"),
        api.get("/laboratory/critical-tasks"),
        api.get("/laboratory/review-tasks"),
        api.get("/laboratory/recollections"),
        api.get("/laboratory/privileges"),
      ];
      if (laboratory || clinical)
        queries.push(
          api.get("/laboratory/qc"),
          api.get("/laboratory/configuration/qc"),
        );
      const data = await Promise.all(queries);
      setOrders(data[0].data.data);
      setCatalogue(data[1].data.data);
      setTasks(data[2].data.data);
      setReviews(data[3].data.data);
      setRecollections(data[4].data.data);
      setPrivileges(data[5].data.data);
      if (data[6]) {
        setQC(data[6].data.data);
        setQCRules(data[7].data.data);
      }
      setObserved(new Date());
    } catch (e) {
      setError(
        e.response?.data?.message ||
          "Could not refresh the laboratory worklist. The displayed observations may be stale.",
      );
    } finally {
      setLoading(false);
    }
  }, [clinical, laboratory, params]);
  useEffect(() => {
    reload();
  }, [reload]);
  const command = useLaboratoryCommand(reload),
    disabled = command.busy || command.uncertain;
  const order = orders.find((o) => o.id === selectedId);
  const allItems = order?.items || [];
  const item = allItems.find((i) => i.id === draft?.itemId);
  const has = (p) => privileges.some((x) => x.privilege === p);
  function edit(i) {
    setDraft({
      itemId: i.id,
      revision: i.lab_revision,
      raw_value: i.result?.raw_value || "",
      unit: i.result?.raw_unit || i.unit || "",
      method: i.method || "",
      specimen_id:
        i.specimens.find((s) => ["RECEIVED", "STORED"].includes(s.state))?.id ||
        "",
      qc_record_id: "",
      remarks: i.result?.remarks || "",
      correction_reason: "",
      correction_of_id: i.result?.technical_decision ? i.result.id : null,
    });
    setChecked(false);
  }
  async function jsonSend(path, text, revision) {
    try {
      setConfigError("");
      const body = JSON.parse(text);
      await command.send(path, body, revision);
    } catch {
      setConfigError(
        "Enter a valid JSON object with the approved content and provenance.",
      );
    }
  }
  const requirements = allItems.flatMap((i) =>
      i.requirements.map((r) => ({ ...r, item: i })),
    ),
    chosen = requirements.find((r) => r.id === specimenRequirement);
  const eligible = chosen
    ? requirements.filter(
        (r) =>
          r.specimen_type === chosen.specimen_type &&
          r.container === chosen.container,
      )
    : [];
  const setDraftField = (key, v) => setDraft((d) => ({ ...d, [key]: v }));
  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Laboratory workflow"
          description="Accession, technical review, authorized release and clinical follow-up."
          actions={
            <button
              className="btn btn-ghost"
              disabled={loading}
              onClick={reload}
            >
              Refresh observations
            </button>
          }
        />
        <nav className="toolbar" aria-label="Laboratory sections">
          {[
            ["orders", "Orders and collection"],
            ["results", "Result entry and review"],
            ["reports", "Release and reports"],
            ["critical", "Critical follow-up"],
            ["configuration", "Approved content"],
            ...(laboratory || clinical
              ? [["reconciliation", "Reconciliation"]]
              : []),
          ].map(([key, label]) => (
            <button
              key={key}
              className={`btn ${tab === key ? "btn-primary" : "btn-ghost"}`}
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <p className="muted">
          {observed
            ? "Observed " + observed.toLocaleString()
            : "No successful observation yet."}
          {loading ? " · Refreshing…" : ""}
        </p>
        {error && (
          <p className="alert-strip alert-danger" role="alert">
            {error}
          </p>
        )}
        {command.message && (
          <div className="alert-strip" role="status">
            {command.message}
            {command.uncertain && (
              <button
                className="btn btn-primary"
                disabled={command.busy}
                onClick={command.reconcile}
              >
                Reconcile original save
              </button>
            )}
          </div>
        )}
        {tab !== "critical" && tab !== "configuration" && (
          <section className="panel" style={{ padding: 16, marginBottom: 16 }}>
            <Field label="Diagnostic order">
              <select
                className="form-input"
                value={selectedId || ""}
                disabled={disabled}
                onChange={(e) => {
                  setSelectedId(Number(value(e)));
                  setDraft(null);
                  setReportSelection([]);
                  setSelectedSpecimen(null);
                  setSnapshot(null);
                }}
              >
                <option value="">Select an order</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    ORD-{o.id} · {o.patient_name} · {o.uhid} · {o.status}
                  </option>
                ))}
              </select>
            </Field>
            {order && (
              <p>
                Patient {order.patient_name} · UHID {order.uhid} · patient
                identifier {order.patient_id} · age {order.age ?? "unknown"} ·{" "}
                {order.gender}. Order priority: {order.urgency}.
              </p>
            )}
          </section>
        )}
        {tab === "orders" && (
          <>
            {clinical && (
              <section
                className="panel"
                style={{ padding: 16, marginBottom: 16 }}
              >
                <h2>Order coded investigations</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    command.send("/orders", {
                      patient_id: Number(patientId),
                      encounter_id: Number(encounterId),
                      test_version_ids: testIds,
                      priority,
                    });
                  }}
                >
                  <div className="form-row-2">
                    <Field label="Patient identifier">
                      <input
                        required
                        className="form-input"
                        value={patientId}
                        disabled={disabled}
                        onChange={(e) => setPatientId(value(e))}
                      />
                    </Field>
                    <Field label="Encounter identifier">
                      <input
                        required
                        className="form-input"
                        value={encounterId}
                        disabled={disabled}
                        onChange={(e) => setEncounterId(value(e))}
                      />
                    </Field>
                  </div>
                  <Field label="Priority">
                    <select
                      className="form-input"
                      value={priority}
                      onChange={(e) => setPriority(value(e))}
                    >
                      {["Routine", "Urgent", "STAT"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Approved tests and panels">
                    <select
                      multiple
                      className="form-input"
                      value={testIds}
                      disabled={disabled}
                      onChange={(e) =>
                        setTestIds(
                          [...e.target.selectedOptions].map((x) => x.value),
                        )
                      }
                    >
                      {catalogue.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.code} · {t.name} · version {t.version}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button className="btn btn-primary" disabled={disabled}>
                    Place order
                  </button>
                </form>
              </section>
            )}
            {order && (
              <section className="panel" style={{ padding: 16 }}>
                <h2>Specimen collection</h2>
                {allItems.map((i) => (
                  <div
                    key={i.id}
                    style={{
                      padding: 8,
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <strong>{i.item_name}</strong> · {i.lab_state}
                    {i.lab_state === "UNMAPPED" && (
                      <p role="status">
                        Identity requires reviewed catalogue reconciliation.
                        Collection is unavailable.
                      </p>
                    )}
                    {i.specimens.map((s) => (
                      <p key={s.id}>
                        <button
                          className="btn btn-ghost"
                          onClick={() => {
                            setSelectedSpecimen(s);
                            setConfirmedPatient("");
                            setScannedAccession("");
                          }}
                        >
                          {s.accession} · {s.specimen_type} · {s.state}
                        </button>
                      </p>
                    ))}
                  </div>
                ))}
                {collector && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (chosen)
                        command.send("/specimens", {
                          patient_id: order.patient_id,
                          specimen_type: chosen.specimen_type,
                          container: chosen.container,
                          location,
                          parent_id: parentId || undefined,
                          links: eligible
                            .filter((r) => specimenItems.includes(r.item.id))
                            .map((r) => ({
                              item_id: r.item.id,
                              requirement_id: r.id,
                            })),
                        });
                    }}
                  >
                    <h3>Plan accession or aliquot</h3>
                    <Field label="Declared specimen requirement">
                      <select
                        required
                        className="form-input"
                        value={specimenRequirement}
                        disabled={disabled}
                        onChange={(e) => {
                          setSpecimenRequirement(value(e));
                          setSpecimenItems([]);
                        }}
                      >
                        <option value="">Choose declared type/container</option>
                        {requirements.map((r) => (
                          <option key={r.id + ":" + r.item.id} value={r.id}>
                            {r.item.item_name} · {r.specimen_type} ·{" "}
                            {r.container}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {eligible.map((r) => (
                      <label
                        key={r.id + ":" + r.item.id}
                        style={{ display: "block" }}
                      >
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={specimenItems.includes(r.item.id)}
                          onChange={(e) =>
                            setSpecimenItems((ids) =>
                              e.target.checked
                                ? [...ids, r.item.id]
                                : ids.filter((x) => x !== r.item.id),
                            )
                          }
                        />
                        {r.item.item_name}
                      </label>
                    ))}
                    <Field label="Location">
                      <input
                        required
                        className="form-input"
                        value={location}
                        onChange={(e) => setLocation(value(e))}
                      />
                    </Field>
                    <Field label="Parent specimen identifier (aliquot only)">
                      <input
                        className="form-input"
                        value={parentId}
                        onChange={(e) => setParentId(value(e))}
                      />
                    </Field>
                    <button
                      className="btn btn-primary"
                      disabled={disabled || !specimenItems.length}
                    >
                      Create accession
                    </button>
                  </form>
                )}
                {selectedSpecimen && (
                  <section style={{ marginTop: 24 }}>
                    <h3>Specimen label and custody</h3>
                    <div style={{ overflowX: "auto" }}>
                      <Barcode
                        value={selectedSpecimen.accession}
                        width={1}
                        height={40}
                      />
                      <p>
                        {order.patient_name} · {order.uhid} ·{" "}
                        {selectedSpecimen.specimen_type} ·{" "}
                        {selectedSpecimen.container}
                      </p>
                    </div>
                    <p>
                      State: {selectedSpecimen.state}. Revision{" "}
                      {selectedSpecimen.revision}. A rejected specimen requires
                      recollection.
                    </p>
                    {collector && (
                      <>
                        <Field label="Confirm patient identifier">
                          <input
                            className="form-input"
                            value={confirmedPatient}
                            onChange={(e) => setConfirmedPatient(value(e))}
                          />
                        </Field>
                        <Field label="Scan or confirm accession">
                          <input
                            className="form-input"
                            value={scannedAccession}
                            onChange={(e) => setScannedAccession(value(e))}
                          />
                        </Field>
                        <Field label="Custody location">
                          <input
                            className="form-input"
                            value={location}
                            onChange={(e) => setLocation(value(e))}
                          />
                        </Field>
                        <Field label="Custody or rejection reason">
                          <input
                            className="form-input"
                            value={custodyReason}
                            onChange={(e) => setCustodyReason(value(e))}
                          />
                        </Field>
                        {(
                          {
                            PLANNED: ["COLLECTED", "REJECTED"],
                            COLLECTED: ["SENT", "RECEIVED", "REJECTED"],
                            SENT: ["RECEIVED", "REJECTED"],
                            RECEIVED: ["STORED", "REJECTED"],
                            STORED: ["REJECTED"],
                            REJECTED: [],
                          }[selectedSpecimen.state] || []
                        ).map((state) => (
                          <button
                            key={state}
                            className="btn btn-ghost"
                            disabled={disabled || !custodyReason || !location}
                            onClick={async () => {
                              const next = await command.send(
                                "/specimens/" +
                                  selectedSpecimen.id +
                                  "/transition",
                                {
                                  state,
                                  patient_id: Number(confirmedPatient),
                                  accession: scannedAccession,
                                  location,
                                  reason: custodyReason,
                                },
                                selectedSpecimen.revision,
                              );
                              if (next) setSelectedSpecimen(next);
                            }}
                          >
                            {state}
                          </button>
                        ))}
                      </>
                    )}
                  </section>
                )}
              </section>
            )}
            <section className="panel" style={{ padding: 16, marginTop: 16 }}>
              <h2>Recollection worklist</h2>
              {recollections.length ? (
                recollections.map((t) => (
                  <p key={t.id}>
                    Patient {t.patient_id} · test item {t.item_id} · {t.reason}{" "}
                    · replacement receipt pending
                  </p>
                ))
              ) : (
                <p>No observed pending recollections.</p>
              )}
            </section>
          </>
        )}
        {tab === "results" && order && (
          <section className="panel" style={{ padding: 16 }}>
            <h2>Result entry and technical review</h2>
            {allItems.map((i) => (
              <p key={i.id}>
                <button
                  className="btn btn-ghost"
                  disabled={disabled}
                  onClick={() => edit(i)}
                >
                  {i.item_name} · {i.lab_state} · revision {i.lab_revision}
                </button>
                {i.result && (
                  <>
                    {" "}
                    · {i.result.normalized_value} {i.result.normalized_unit} ·{" "}
                    {i.result.abnormal_flag.replaceAll("_", " ")} ·{" "}
                    {i.result.technical_decision ||
                      "Provisional; technical review pending"}
                  </>
                )}
              </p>
            ))}
            {draft && item && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  command.send(
                    "/items/" + item.id + "/results",
                    {
                      ...draft,
                      correction_of_id: draft.correction_of_id || undefined,
                      correction_reason: draft.correction_of_id
                        ? draft.correction_reason
                        : undefined,
                      qc_record_id: draft.qc_record_id || undefined,
                    },
                    draft.revision,
                  );
                }}
              >
                <h3>{item.item_name}</h3>
                <p>
                  Draft revision {draft.revision}; latest observed revision{" "}
                  {item.lab_revision}. Missing approved reference intervals
                  never mean normal.
                </p>
                {draft.revision !== item.lab_revision && (
                  <div className="alert-strip" role="alert">
                    This result changed. Your draft is preserved.
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                      />
                      I reviewed the current result and intended correction
                    </label>
                    <button
                      type="button"
                      disabled={!checked}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          revision: item.lab_revision,
                          correction_of_id: item.result?.technical_decision
                            ? item.result.id
                            : null,
                        }))
                      }
                    >
                      Use reviewed current revision
                    </button>
                  </div>
                )}
                <Field label="Received specimen">
                  <select
                    required
                    className="form-input"
                    disabled={disabled}
                    value={draft.specimen_id}
                    onChange={(e) => setDraftField("specimen_id", value(e))}
                  >
                    <option value="">Select specimen</option>
                    {item.specimens
                      .filter((s) => ["RECEIVED", "STORED"].includes(s.state))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.accession}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Raw observed value">
                  <input
                    required
                    className="form-input"
                    disabled={disabled}
                    value={draft.raw_value}
                    onChange={(e) => setDraftField("raw_value", value(e))}
                  />
                </Field>
                <Field label="Observed unit">
                  <input
                    required
                    className="form-input"
                    disabled={disabled}
                    value={draft.unit}
                    onChange={(e) => setDraftField("unit", value(e))}
                  />
                </Field>
                <Field label="Method">
                  <input
                    required
                    className="form-input"
                    disabled={disabled}
                    value={draft.method}
                    onChange={(e) => setDraftField("method", value(e))}
                  />
                </Field>
                <Field label="QC record">
                  <select
                    className="form-input"
                    value={draft.qc_record_id}
                    onChange={(e) => setDraftField("qc_record_id", value(e))}
                  >
                    <option value="">Select recorded QC evidence</option>
                    {qc.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.id} · {q.status}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Remarks">
                  <textarea
                    className="form-input"
                    value={draft.remarks}
                    onChange={(e) => setDraftField("remarks", value(e))}
                  />
                </Field>
                {draft.correction_of_id && (
                  <Field label="Correction reason">
                    <input
                      required
                      className="form-input"
                      value={draft.correction_reason}
                      onChange={(e) =>
                        setDraftField("correction_reason", value(e))
                      }
                    />
                  </Field>
                )}
                {laboratory && (
                  <button
                    className="btn btn-primary"
                    disabled={disabled || draft.revision !== item.lab_revision}
                  >
                    Save provisional result
                  </button>
                )}
                {has("TECHNICAL_REVIEW") && item.result && (
                  <div>
                    {["VERIFIED", "REPEAT"].map((decision) => (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        key={decision}
                        disabled={
                          disabled ||
                          draft.revision !== item.lab_revision ||
                          !draft.qc_record_id ||
                          !draft.remarks
                        }
                        onClick={() =>
                          command.send(
                            "/results/" + item.result.id + "/technical-review",
                            {
                              decision,
                              qc_record_id: draft.qc_record_id,
                              reason: draft.remarks,
                            },
                            draft.revision,
                          )
                        }
                      >
                        {decision === "VERIFIED"
                          ? "Verify technical result"
                          : "Request repeat"}
                      </button>
                    ))}
                  </div>
                )}
              </form>
            )}
            {has("TECHNICAL_REVIEW") && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  try {
                    setConfigError("");
                    command.send("/qc", {
                      rule_id: qcRule,
                      run_id: qcRun || undefined,
                      status: qcStatus,
                      evidence: JSON.parse(qcEvidence),
                    });
                  } catch {
                    setConfigError("QC evidence must be a valid JSON object.");
                  }
                }}
              >
                <h3>Record actual QC evidence</h3>
                <Field label="Approved QC rule">
                  <select
                    required
                    className="form-input"
                    value={qcRule}
                    onChange={(e) => setQCRule(value(e))}
                  >
                    <option value="">Choose approved rule</option>
                    {qcRules.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.id} · {q.method} · version {q.version}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Analyzer run identifier (when applicable)">
                  <input
                    className="form-input"
                    value={qcRun}
                    onChange={(e) => setQCRun(value(e))}
                  />
                </Field>
                <Field label="QC outcome">
                  <select
                    className="form-input"
                    value={qcStatus}
                    onChange={(e) => setQCStatus(value(e))}
                  >
                    {["PASS", "FAIL", "REPEAT"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Measured controls and source evidence (JSON)">
                  <textarea
                    required
                    className="form-input"
                    value={qcEvidence}
                    onChange={(e) => setQCEvidence(value(e))}
                  />
                </Field>
                <button className="btn btn-primary" disabled={disabled}>
                  Record QC
                </button>
                {configError && <p role="alert">{configError}</p>}
              </form>
            )}
          </section>
        )}
        {tab === "reports" && order && (
          <section className="panel" style={{ padding: 16 }}>
            <h2>Authorized reports</h2>
            {order.report_versions.map((v) => (
              <p key={v.id}>
                Version {v.version} · {v.status} ·{" "}
                {new Date(v.released_at).toLocaleString()}{" "}
                <button
                  className="btn btn-ghost"
                  onClick={async () => {
                    try {
                      setSnapshot(
                        (await api.get("/laboratory/reports/" + v.id)).data
                          .data,
                      );
                    } catch (e) {
                      setError(
                        e.response?.data?.message || "Report unavailable.",
                      );
                    }
                  }}
                >
                  Read exact version
                </button>{" "}
                <a
                  href={"/api/laboratory/reports/" + v.id + "/pdf"}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download PDF
                </a>
              </p>
            ))}
            {snapshot && (
              <div>
                <h3>
                  {snapshot.version.status} · version {snapshot.version.version}
                </h3>
                {snapshot.results.map((x) => (
                  <p key={x.id}>
                    {x.item_name}: {x.normalized_value} {x.normalized_unit} ·{" "}
                    {x.abnormal_flag.replaceAll("_", " ")} · result version{" "}
                    {x.version}
                  </p>
                ))}
              </div>
            )}
            {clinical && has("RELEASE") && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  command.send(
                    "/orders/" + order.id + "/release",
                    {
                      status: reportStatus,
                      reason: reportReason,
                      result_version_ids: reportSelection,
                    },
                    order.lab_revision,
                  );
                }}
              >
                <h3>Release reviewed version</h3>
                {allItems
                  .filter((i) => i.result?.technical_decision === "VERIFIED")
                  .map((i) => (
                    <label key={i.id} style={{ display: "block" }}>
                      <input
                        type="checkbox"
                        checked={reportSelection.includes(i.result.id)}
                        onChange={(e) =>
                          setReportSelection((ids) =>
                            e.target.checked
                              ? [...ids, i.result.id]
                              : ids.filter((x) => x !== i.result.id),
                          )
                        }
                      />
                      {i.item_name} · current result version {i.result.version}
                    </label>
                  ))}
                <Field label="Report status">
                  <select
                    className="form-input"
                    value={reportStatus}
                    onChange={(e) => setReportStatus(value(e))}
                  >
                    {["PRELIMINARY", "FINAL", "AMENDED"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Release or amendment reason">
                  <input
                    required
                    className="form-input"
                    value={reportReason}
                    onChange={(e) => setReportReason(value(e))}
                  />
                </Field>
                <button
                  className="btn btn-primary"
                  disabled={disabled || !reportSelection.length}
                >
                  Authorize report release
                </button>
              </form>
            )}
            {!has("RELEASE") && (
              <p>
                Final release requires a current laboratory release privilege.
              </p>
            )}
          </section>
        )}
        {tab === "critical" && (
          <>
            <section className="panel" style={{ padding: 16 }}>
              <h2>Critical-result follow-up</h2>
              <p>
                Notification and report opening do not acknowledge or close a
                task. Discharge does not close follow-up.
              </p>
              <Field label="Acknowledgment evidence or documented clinical action">
                <textarea
                  className="form-input"
                  value={taskAction}
                  onChange={(e) => setTaskAction(value(e))}
                />
              </Field>
              {tasks.map((t) => (
                <article
                  key={t.id}
                  style={{
                    padding: 12,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <strong>
                    Patient {t.patient_id} · {t.state}
                  </strong>
                  <p>
                    Responsible user: {t.assigned_user_id || "Unavailable"} ·
                    escalation level {t.escalation_level} ·{" "}
                    {t.next_due_at
                      ? "Next deadline " +
                        new Date(t.next_due_at).toLocaleString()
                      : "No pending approved escalation deadline"}
                  </p>
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      try {
                        setSnapshot({
                          deliveries: (
                            await api.get(
                              "/laboratory/critical-tasks/" +
                                t.id +
                                "/deliveries",
                            )
                          ).data.data,
                        });
                      } catch (e) {
                        setError(
                          e.response?.data?.message ||
                            "Delivery evidence unavailable.",
                        );
                      }
                    }}
                  >
                    Review delivery evidence
                  </button>
                  {clinical && t.state !== "CLOSED" && (
                    <button
                      className="btn btn-primary"
                      disabled={disabled || !taskAction}
                      onClick={() =>
                        command.send(
                          "/critical-tasks/" + t.id + "/action",
                          {
                            action:
                              t.state === "OPEN" ? "acknowledge" : "close",
                            reason: taskAction,
                            clinical_action: taskAction,
                          },
                          t.revision,
                        )
                      }
                    >
                      {t.state === "OPEN"
                        ? "Acknowledge receipt"
                        : "Document action and close"}
                    </button>
                  )}
                  {laboratory && t.state !== "CLOSED" && (
                    <button
                      className="btn btn-ghost"
                      disabled={
                        disabled ||
                        !contact.recipient ||
                        !contact.channel ||
                        !contact.evidence
                      }
                      onClick={() =>
                        command.send(
                          "/critical-tasks/" + t.id + "/deliveries",
                          {
                            recipient_user_id: Number(contact.recipient),
                            channel: contact.channel,
                            outcome: contact.outcome,
                            evidence: contact.evidence,
                          },
                        )
                      }
                    >
                      Record contact attempt
                    </button>
                  )}
                </article>
              ))}
              {snapshot?.deliveries?.map((x) => (
                <p key={x.id}>
                  {new Date(x.created_at).toLocaleString()} · recipient{" "}
                  {x.recipient_user_id || "unavailable"} · {x.channel} ·{" "}
                  {x.outcome} · {x.evidence}
                </p>
              ))}
              {laboratory && (
                <>
                  <h3>Communication attempt</h3>
                  {[
                    ["recipient", "Recipient user identifier"],
                    ["channel", "Communication channel"],
                    ["evidence", "Contact evidence"],
                  ].map(([k, label]) => (
                    <Field key={k} label={label}>
                      <input
                        className="form-input"
                        value={contact[k]}
                        onChange={(e) =>
                          setContact((c) => ({ ...c, [k]: value(e) }))
                        }
                      />
                    </Field>
                  ))}
                  <Field label="Contact outcome">
                    <select
                      className="form-input"
                      value={contact.outcome}
                      onChange={(e) =>
                        setContact((c) => ({ ...c, outcome: value(e) }))
                      }
                    >
                      {["CONTACTED", "UNAVAILABLE", "FAILED"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </Field>
                  <button
                    className="btn btn-ghost"
                    disabled={disabled}
                    onClick={() => command.send("/critical-tasks/advance", {})}
                  >
                    Process due approved escalations
                  </button>
                </>
              )}
            </section>
            <section className="panel" style={{ padding: 16, marginTop: 16 }}>
              <h2>Clinician result review</h2>
              {reviews.map((t) => (
                <p key={t.id}>
                  Patient {t.patient_id} · {t.state}
                  {clinical && t.state === "OPEN" && (
                    <button
                      className="btn btn-primary"
                      disabled={disabled || !taskAction}
                      onClick={() =>
                        command.send(
                          "/review-tasks/" + t.id + "/action",
                          { action: "close", clinical_action: taskAction },
                          t.revision,
                        )
                      }
                    >
                      Document review action
                    </button>
                  )}
                </p>
              ))}
            </section>
          </>
        )}
        {tab === "reconciliation" && (
          <LaboratoryReconciliation
            orders={orders}
            catalogue={catalogue}
            command={command}
          />
        )}
        {tab === "configuration" && (
          <section className="panel" style={{ padding: 16 }}>
            <h2>Approved laboratory content</h2>
            <p>
              Reference intervals, critical thresholds, QC criteria and
              escalation timetables require clinical approval, source evidence
              and effective dates. Missing configuration is never replaced with
              guessed values.
            </p>
            {has("CONTENT") && (
              <>
                <Field label="Catalogue definition (approved JSON)">
                  <textarea
                    className="form-input"
                    rows={8}
                    value={catalogueText}
                    onChange={(e) => setCatalogueText(value(e))}
                  />
                </Field>
                <button
                  className="btn btn-primary"
                  disabled={disabled || !catalogueText}
                  onClick={() => jsonSend("/catalogue", catalogueText)}
                >
                  Create catalogue revision
                </button>
                <Field label="Configuration type">
                  <select
                    className="form-input"
                    value={configurationKind}
                    onChange={(e) => setConfigurationKind(value(e))}
                  >
                    {[
                      "reference",
                      "critical",
                      "qc",
                      "conversion",
                      "escalation",
                    ].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Approved configuration (JSON with provenance)">
                  <textarea
                    className="form-input"
                    rows={8}
                    value={configurationText}
                    onChange={(e) => setConfigurationText(value(e))}
                  />
                </Field>
                <button
                  className="btn btn-primary"
                  disabled={disabled || !configurationText}
                  onClick={() =>
                    jsonSend(
                      "/configuration/" + configurationKind,
                      configurationText,
                    )
                  }
                >
                  Create approved policy version
                </button>
              </>
            )}
            {configError && <p role="alert">{configError}</p>}
            {admin && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  command.send("/privileges", {
                    ...grant,
                    user_id: Number(grant.user_id),
                  });
                }}
              >
                <h3>Time-limited laboratory privilege</h3>
                {[
                  ["user_id", "Clinical user identifier"],
                  ["reason", "Grant reason"],
                  ["valid_from", "Valid from (ISO timestamp with timezone)"],
                  ["valid_until", "Valid until (ISO timestamp with timezone)"],
                ].map(([k, label]) => (
                  <Field key={k} label={label}>
                    <input
                      required
                      className="form-input"
                      value={grant[k]}
                      onChange={(e) =>
                        setGrant((g) => ({ ...g, [k]: value(e) }))
                      }
                    />
                  </Field>
                ))}
                <Field label="Privilege">
                  <select
                    className="form-input"
                    value={grant.privilege}
                    onChange={(e) =>
                      setGrant((g) => ({ ...g, privilege: value(e) }))
                    }
                  >
                    {["CONTENT", "TECHNICAL_REVIEW", "RELEASE", "ANALYZER"].map(
                      (x) => (
                        <option key={x}>{x}</option>
                      ),
                    )}
                  </select>
                </Field>
                <button className="btn btn-primary" disabled={disabled}>
                  Grant privilege
                </button>
              </form>
            )}
            <h3>Catalogue observations</h3>
            {catalogue.map((t) => (
              <p key={t.id}>
                {t.code} · {t.name} · {t.unit || "panel"} · version {t.version}
              </p>
            ))}
          </section>
        )}
        <p>
          <Link to="/lab/governed">Laboratory workspace</Link> · Historical
          reports remain read-only.
        </p>
      </main>
    </>
  );
}
