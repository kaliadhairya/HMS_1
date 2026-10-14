import { useCallback, useEffect, useRef, useState } from 'react';

// Unsaved clinical text that survives a reload or a crashed tab (completion
// C2). The draft, and any save whose answer never arrived (its request and
// Idempotency-Key), are kept in this tab's sessionStorage: never shared with
// other tabs, gone when the tab closes, and cleared at sign-out. After a
// reload the screen offers to restore the draft, or re-sends the pending
// save with its original key so it cannot be applied twice.
const PREFIX = 'hms.draft.v1';
const keyFor = (userId, scope, id) => `${PREFIX}:${userId}:${scope}:${id}`;

function readEntry(key) {
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeEntry(key, entry) {
  try { if (entry) sessionStorage.setItem(key, JSON.stringify(entry)); else sessionStorage.removeItem(key); } catch { /* storage full or blocked: in-memory draft still works */ }
}

// Removes every draft kept in this tab (sign-out, or another user signing in).
export function clearAllDrafts() {
  try {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k?.startsWith(`${PREFIX}:`)) keys.push(k); }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* nothing to clear */ }
}

/**
 * const draft = useRecoverableDraft({ userId, scope: 'encounter-note', id });
 * draft.recovered   -> { value, revision, savedAt, pending } found when the screen opened, or null
 * draft.keep(value, revision)  -> remember the unsaved text (debounced)
 * draft.setPending(request)    -> remember a save whose answer is not known (or null)
 * draft.clear()                -> after a confirmed save, or when the user discards it
 */
export default function useRecoverableDraft({ userId, scope, id, enabled = true }) {
  const key = userId && id ? keyFor(userId, scope, id) : null;
  const [recovered, setRecovered] = useState(null);
  const timer = useRef(null);
  const entry = useRef(null);

  useEffect(() => {
    if (!key || !enabled) { setRecovered(null); return; }
    const found = readEntry(key);
    entry.current = found;
    setRecovered(found && (found.value || found.pending) ? found : null);
  }, [key, enabled]);

  const persist = useCallback(() => { if (key) writeEntry(key, entry.current); }, [key]);

  const keep = useCallback((value, revision) => {
    if (!key || !enabled) return;
    entry.current = { ...(entry.current || {}), value, revision, savedAt: new Date().toISOString() };
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, 400);
  }, [key, enabled, persist]);

  const setPending = useCallback((request) => {
    if (!key || !enabled) return;
    entry.current = { ...(entry.current || {}), pending: request || undefined };
    persist();
  }, [key, enabled, persist]);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    entry.current = null;
    if (key) writeEntry(key, null);
    setRecovered(null);
  }, [key]);

  const dismiss = useCallback(() => setRecovered(null), []);
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  // A pending write flushes immediately if the tab is closing.
  useEffect(() => {
    const flush = () => { clearTimeout(timer.current); persist(); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [persist]);

  return { recovered, keep, setPending, clear, dismiss };
}
