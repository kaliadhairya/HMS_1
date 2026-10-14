import { useRef, useState } from 'react';
import api from '../api/axios';
import { commandKey, confirmationUnknown } from '../pages/hms/pharmacy/medicationCommand.mjs';

// Preserve the exact command through an uncertain response. Refresh failure
// after a confirmed commit never turns that commit back into an unknown one.
export function useGovernedCommand(refresh) {
  const pending = useRef(null), running = useRef(false);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState('');
  async function send(path, body, revision, reconcile = false) {
    if (running.current || (!reconcile && pending.current)) return null;
    const request = reconcile ? pending.current : {path, body: JSON.parse(JSON.stringify(body)), revision, key: commandKey()};
    if (!request) return null;
    running.current = true; pending.current = request; setBusy(true); setMessage('');
    try {
      const response = await api.post(request.path, request.body, {headers: {'Idempotency-Key': request.key, ...(request.revision === undefined ? {} : {'If-Match': String(request.revision)})}});
      pending.current = null; setUncertain(false); setMessage('Change confirmed.');
      try { await refresh(); } catch { setMessage('Change confirmed. Refresh failed; reload to see the committed change.'); }
      return {path: request.path, data: response.data};
    } catch (error) {
      const unknown = confirmationUnknown(error) || error.response?.status >= 500;
      if (!unknown) pending.current = null;
      setUncertain(unknown);
      setMessage(unknown ? 'Confirmation is uncertain. Keep your draft and reconcile the original request.' : error.response?.data?.message || 'The change was refused. Your draft is preserved.');
      return null;
    } finally { running.current = false; setBusy(false); }
  }
  return {send, busy, uncertain, message, reconcile: () => send(null, null, undefined, true)};
}
