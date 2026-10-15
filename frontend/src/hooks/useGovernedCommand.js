import { useRef, useState } from 'react';
import api from '../api/axios';
import { commandKey, confirmationUnknown } from '../pages/hms/pharmacy/medicationCommand.mjs';

// Preserve the exact command through an uncertain response. Refresh failure
// after a confirmed commit never turns that commit back into an unknown one.
export function useGovernedCommand(refresh, scope) {
  const pending = useRef(null), running = useRef(false), currentScope = useRef(scope);
  currentScope.current=scope;
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [failure, setFailure] = useState(null);
  async function send(path, body, revision, reconcile = false, method = 'post') {
    if(scope!==currentScope.current)return null;
    if (running.current || (!reconcile && pending.current)) return null;
    const request = reconcile ? pending.current : {path, body: JSON.parse(JSON.stringify(body)), revision, method, scope, key: commandKey()};
    if (!request) return null;
    if(request.scope!==currentScope.current){setMessage('Return to the original record to reconcile its pending request.');return null;}
    running.current = true; pending.current = request; setBusy(true); setMessage(''); setFailure(null);
    try {
      const response = await api[request.method](request.path, request.body, {headers: {'Idempotency-Key': request.key, ...(request.revision === undefined ? {} : {'If-Match': String(request.revision)})}});
      pending.current = null; setUncertain(false);
      try { if(request.scope===currentScope.current){await refresh(response.data);setMessage('Change confirmed.');}else setMessage('The earlier request is confirmed. Open its original record to review it.'); } catch { setMessage('Change confirmed. Refresh failed; reload to see the committed change.'); }
      return {path: request.path, data: response.data};
    } catch (error) {
      setFailure({...error.response?.data,status:error.response?.status,scope:request.scope});
      const unknown = confirmationUnknown(error) || error.response?.status >= 500;
      if (!unknown) pending.current = null;
      setUncertain(unknown);
      setMessage(unknown ? 'Confirmation is uncertain. Keep your draft and reconcile the original request.' : error.response?.data?.message || 'The change was refused. Your draft is preserved.');
      return null;
    } finally { running.current = false; setBusy(false); }
  }
  return {send, busy, uncertain, message, failure, reconcile: () => send(null, null, undefined, true)};
}
