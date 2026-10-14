import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/axios';
import { useSocket } from '../context/SocketContext';

// Shared reads for clinical lists (completion C2). One cache for the tab:
// screens that show the same list share one request and one answer; a list
// refreshes on a timer, when the tab becomes visible again, and when a live
// event says it changed. A failed refresh never turns into an empty list:
// the last answer stays on screen, marked with its time and the failure.
const cache = new Map(); // key -> { data, at, promise }
const listeners = new Map(); // key -> Set(fn)

function notify(key) { (listeners.get(key) || new Set()).forEach((fn) => fn()); }

async function fetchShared(key, url, params) {
  const entry = cache.get(key) || {};
  if (entry.promise) return entry.promise;
  const promise = api.get(url, { params }).then((res) => {
    cache.set(key, { data: res.data, at: Date.now() });
    notify(key);
    return res.data;
  }).finally(() => {
    const now = cache.get(key);
    if (now?.promise === promise) cache.set(key, { data: now.data, at: now.at });
  });
  cache.set(key, { ...entry, promise });
  return promise;
}

// Drops every cached answer (on sign-out, so the next user never sees them).
export function clearLiveCache() { cache.clear(); listeners.clear(); }

/**
 * useLiveQuery('/worklist', { params, select, refreshMs, events })
 * -> { data, error, loading, updatedAt, stale, refresh }
 * `select(responseBody)` picks the list; `events` are live event types that
 * mean this list changed.
 */
export function useLiveQuery(url, { params = null, select = (b) => b, refreshMs = 30000, events = [], enabled = true } = {}) {
  const key = `${url}?${params ? JSON.stringify(params) : ''}`;
  const socket = useSocket();
  const selectRef = useRef(select);
  selectRef.current = select;
  const read = () => cache.get(key);
  const [state, setState] = useState(() => ({ body: read()?.data, at: read()?.at || null, error: null, loading: !read()?.data }));

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      await fetchShared(key, url, params);
      setState({ body: read()?.data, at: read()?.at, error: null, loading: false });
    } catch (err) {
      const message = err.response?.data?.message || (err.response ? `The server answered ${err.response.status}.` : 'The server could not be reached.');
      setState((s) => ({ ...s, error: message, loading: false }));
    }
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) return undefined;
    const fn = () => setState((s) => ({ ...s, body: read()?.data, at: read()?.at }));
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    refresh();
    const timer = refreshMs ? setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, refreshMs) : null;
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { listeners.get(key)?.delete(fn); if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [key, refresh, refreshMs, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const eventList = events.join('|');
  useEffect(() => {
    if (!socket || !eventList) return undefined;
    const types = eventList.split('|');
    const onEvent = () => refresh();
    types.forEach((t) => socket.on(t, onEvent));
    return () => types.forEach((t) => socket.off(t, onEvent));
  }, [socket, eventList, refresh]);

  const data = state.body === undefined ? undefined : selectRef.current(state.body);
  return { data, error: state.error, loading: state.loading, updatedAt: state.at, stale: Boolean(state.error && state.at), refresh };
}
