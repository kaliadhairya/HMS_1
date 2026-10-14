import { RefreshCw, TriangleAlert } from 'lucide-react';

const time = (at) => new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' });

// How current a list is (completion C2). After a failed refresh it says, in
// words and with an icon, that the list shown is from an earlier time; a
// list that never loaded says so instead of looking empty.
export default function Freshness({ query, label = 'list' }) {
  const { error, updatedAt, loading, refresh } = query;
  if (error && !updatedAt) {
    return (
      <div className="status status-danger" role="alert" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <TriangleAlert size={14} aria-hidden="true" />
        <span>Could not load the {label}: {error} Nothing is shown because nothing was loaded — this does not mean the {label} is empty.</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={refresh}>Try again</button>
      </div>
    );
  }
  if (error) {
    return (
      <div className="status status-warning" role="alert" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <TriangleAlert size={14} aria-hidden="true" />
        <span>Could not refresh the {label}. Showing what it was at <strong>{time(updatedAt)}</strong>; it may have changed since.</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={refresh}>Try again</button>
      </div>
    );
  }
  if (!updatedAt) return loading ? <span className="cell-secondary" role="status">Loading…</span> : null;
  return (
    <span className="cell-secondary" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      Updated {time(updatedAt)}
      <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} aria-label={`Refresh the ${label}`}><RefreshCw size={13} aria-hidden="true" /></button>
    </span>
  );
}
