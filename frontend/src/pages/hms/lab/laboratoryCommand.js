import { useRef, useState } from "react";
import api from "../../../api/axios";
function requestKey() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function useLaboratoryCommand(refresh) {
  const pending = useRef(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [uncertain, setUncertain] = useState(false);
  async function send(path, body, revision, reconcile = false) {
    if (running.current || (!reconcile && pending.current)) return;
    const request = reconcile
      ? pending.current
      : {
          path,
          body: JSON.parse(JSON.stringify(body)),
          key: requestKey(),
          revision,
        };
    if (!request) return;
    running.current = true;
    pending.current = request;
    setBusy(true);
    setMessage("");
    try {
      const response = await api.post(
        "/laboratory" + request.path,
        request.body,
        {
          headers: {
            "Idempotency-Key": request.key,
            ...(request.revision !== undefined
              ? { "If-Match": String(request.revision) }
              : {}),
          },
        },
      );
      pending.current = null;
      setUncertain(false);
      setMessage("Saved and confirmed.");
      try { await refresh(); } catch {
        setMessage('Saved and confirmed. The view could not refresh; reload it to see the committed change.');
      }
      return response.data.data;
    } catch (e) {
      const unknown = !e.response || e.response.status >= 500;
      setUncertain(unknown);
      if (!unknown) pending.current = null;
      setMessage(
        unknown
          ? "Save outcome uncertain. Keep this screen open and reconcile the original request."
          : e.response.data?.message ||
              "The change was refused. Your draft is preserved.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return {
    send,
    busy,
    message,
    uncertain,
    reconcile: () => send(null, null, null, true),
  };
}
