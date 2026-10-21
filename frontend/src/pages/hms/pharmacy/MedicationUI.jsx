import "./Medication.css";
import {
  cloneElement,
  isValidElement,
  useId,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import api from "../../../api/axios";
import { useAuth } from "../../../context/AuthContext";
import { commandKey, confirmationUnknown } from "./medicationCommand.mjs";
export function MedicationLinks() {
  const { user } = useAuth();
  const entries = [
    ["/medication/orders", "Coded prescribing", ["doctor"]],
    [
      "/medication/pharmacy",
      "Pharmacist verification & supply",
      ["pharmacist"],
    ],
    ["/medication/nursing", "eMAR & handover", ["nurse"]],
    ["/medication/stock", "Locations & ward supply", ["nurse", "pharmacist"]],
    ["/medication/controlled", "Controlled drugs", ["nurse", "pharmacist"]],
    ["/medication/catalogue", "Approved medication identities", ["pharmacist"]],
    [
      "/medication/witness",
      "Independent witness inbox",
      ["doctor", "nurse", "pharmacist"],
    ],
  ];
  return (
    <nav
      aria-label="Medication workflows"
      className="inline-actions medication-nav"
      style={{ padding: "12px 24px", flexWrap: "wrap" }}
    >
      {entries
        .filter((e) => e[2].includes(user?.role))
        .map(([path, label]) => (
          <Link key={path} to={path}>
            {label}
          </Link>
        ))}
    </nav>
  );
}
export function Field({ label, children, ...props }) {
  const generated = useId(),
    fieldId = props.id || children?.props?.id || generated;
  return (
    <div className="form-group" style={{ display: "grid", gap: 6 }}>
      <label className="form-label" htmlFor={fieldId}>
        {label}
      </label>
      {isValidElement(children) ? (
        cloneElement(children, { id: fieldId })
      ) : (
        <input className="form-input" id={fieldId} {...props} />
      )}
    </div>
  );
}
export function Select({ label, children, ...props }) {
  return (
    <Field label={label}>
      <select className="form-select" {...props}>
        {children}
      </select>
    </Field>
  );
}
export const timeInput = (v) =>
  v
    ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
export const iso = (v) => new Date(v).toISOString();
export function SaveStatus({ value }) {
  return (
    <p
      role={
        value.kind === "failed" || value.kind === "conflict"
          ? "alert"
          : "status"
      }
      aria-live="polite"
    >
      <strong>{value.kind.replaceAll("_", " ")}.</strong> {value.message}
      {value.retry && (
        <button type="button" onClick={value.retry}>
          Reconcile original save
        </button>
      )}
    </p>
  );
}
export function useCommand(onSaved, namespace = "/medication") {
  const [status, setStatus] = useState({
    kind: "ready",
    message: "Changes are confirmed only after the server responds.",
  });
  const busy = useRef(false),
    uncertain = useRef(null);
  const run = useCallback(
    async (path, body, revision, options = {}) => {
      if (busy.current) return null;
      if (uncertain.current && !options.reconciling) {
        setStatus((s) => ({
          ...s,
          message:
            "Reconcile the previous request before starting another save. Your current draft is preserved.",
        }));
        return null;
      }
      // A call may name its own API (the v2 medication commands); a retry keeps the original.
      const attempt = options.reconciling
        ? uncertain.current
        : {
            path,
            body: JSON.parse(JSON.stringify(body)),
            revision,
            key: options.key || commandKey(),
            namespace: options.namespace || namespace,
          };
      if (!attempt) return null;
      busy.current = true;
      setStatus({
        kind: "saving",
        message: "Waiting for server confirmation…",
      });
      try {
        const response = await api.post(
          (attempt.namespace || namespace) + attempt.path,
          attempt.body,
          {
            headers: {
              "Idempotency-Key": attempt.key,
              ...(attempt.revision !== undefined
                ? { "If-Match": String(attempt.revision) }
                : {}),
            },
          },
        );
        uncertain.current = null;
        try {
          await onSaved?.(response.data.data ?? response.data, attempt);
          setStatus({
            kind: "saved",
            message: "The server confirmed this change.",
          });
        } catch {
          setStatus({
            kind: "saved",
            message:
              "The server confirmed the change, but refreshing the view failed.",
          });
        }
        return response.data.data ?? response.data;
      } catch (error) {
        const unknown = confirmationUnknown(error);
        uncertain.current = unknown ? attempt : null;
        setStatus({
          kind:
            error.response?.status === 412
              ? "conflict"
              : unknown
                ? "pending_confirmation"
                : "failed",
          message:
            error.response?.data?.message ||
            "Confirmation is unavailable. Reconcile this request before repeating the action.",
          ...(unknown
            ? {
                retry: () =>
                  run(attempt.path, attempt.body, attempt.revision, {
                    reconciling: true,
                  }),
              }
            : {}),
        });
        return null;
      } finally {
        busy.current = false;
      }
    },
    [onSaved, namespace],
  );
  return { run, status, saving: status.kind === "saving", setStatus };
}
// Clinical medication commands go to the v2 API (completion A3), which names records by public
// identifier, checks their public version (If-Match) and takes exact decimals as strings.
export const V2 = { namespace: "/v2" };
export async function publicId(kind, legacyId) {
  const r = await api.get(`/v2/legacy-identities/${kind}/${legacyId}`);
  return r.data.data.id;
}
// Only the fields a v2 command accepts, without blanks: an empty optional field is left out.
export function only(fields, values) {
  return Object.fromEntries(
    fields
      .filter((k) => values[k] !== undefined && values[k] !== null && values[k] !== "")
      .map((k) => [k, values[k]]),
  );
}
export function useRows(path) {
  const [rows, setRows] = useState([]),
    [state, setState] = useState({ kind: "loading", message: "Loading…" });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const g = ++generation.current;
    try {
      const r = await api.get("/medication" + path);
      if (g === generation.current) {
        setRows(r.data.data);
        setState({
          kind: "current",
          message: "Last confirmed " + new Date().toLocaleTimeString(),
        });
      }
    } catch (e) {
      if (g === generation.current)
        setState({
          kind: "stale",
          message:
            e.response?.data?.message ||
            "Refresh failed; previously shown data may be stale.",
        });
    }
  }, [path]);
  useEffect(() => {
    refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  return { rows, state, refresh };
}
export function Findings({ findings = [], coverage = {} }) {
  return (
    <section aria-label="Medication safety assessment">
      <p>
        <strong>Declared coverage:</strong>{" "}
        {Object.entries(coverage)
          .map(([k, v]) => `${k}: ${v ? "performed" : "check unavailable"}`)
          .join(" · ") || "Not assessed"}
      </p>
      <ul>
        {findings.map((f) => (
          <li key={f.code}>
            <strong>
              {f.severity}: {f.code}
            </strong>{" "}
            — {f.message}
            {f.override_allowed === false ? " (cannot override)" : ""}
          </li>
        ))}
      </ul>
      {!Object.keys(coverage).length && (
        <p role="status">Coverage incomplete. Pharmacist review is required.</p>
      )}
    </section>
  );
}
