import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, Lock, ShieldAlert, Upload } from 'lucide-react';
import api from '../../../api/axios';
import { openAuthenticatedBlob } from '../../../utils/authenticatedDownload';
import EmptyState from '../../../components/ui/EmptyState';

const TYPES = ['Report', 'Prescription', 'Referral', 'Consent', 'Identity', 'Discharge', 'Imaging', 'Other'];
const fmt = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const TONE = { Available: 'status-success', Quarantined: 'status-warning', Rejected: 'status-danger', Withdrawn: 'status-neutral' };

// Private patient documents (completion A4): uploads are encrypted and
// checked before anyone can open them; nothing is ever deleted, only
// withdrawn with a reason, and an administrator can place a legal hold.
export default function PatientDocumentsPanel({ patientId, role }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [docType, setDocType] = useState('Report');
  const [busy, setBusy] = useState(false);
  const canWrite = ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist'].includes(role);
  const isAdmin = ['super_admin', 'admin'].includes(role);

  const load = useCallback(async () => {
    try { setDocs((await api.get(`/patients/hms/${patientId}/documents`)).data.data || []); setError(''); }
    catch (err) { setError(err.response?.data?.message || 'Documents could not be loaded.'); }
  }, [patientId]);
  useEffect(() => { load(); }, [load]);

  const send = async (e) => {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('docType', docType);
      const r = await api.post(`/patients/hms/${patientId}/documents`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const d = r.data.data;
      if (d.state === 'Available') toast.success('Document stored');
      else if (d.state === 'Rejected') toast.error(`Not stored for use: ${d.scan?.detail || 'it failed its checks'}`, { duration: 9000 });
      else toast(`Held in quarantine: ${d.scan?.detail || 'it could not be checked yet'}`, { duration: 9000 });
      setFile(null); e.target.reset();
      await load();
    } catch (err) { toast.error(err.response?.data?.message || 'The document could not be stored.', { duration: 9000 }); }
    finally { setBusy(false); }
  };
  const act = async (path, body, ok) => {
    try { await api.post(`/patients/hms/${patientId}/documents/${path}`, body); toast.success(ok); await load(); }
    catch (err) { toast.error(err.response?.data?.message || 'That did not work.', { duration: 9000 }); }
  };
  const open = (d) => openAuthenticatedBlob(`/patients/hms/${patientId}/documents/${d.id}/content`, { download: true, filename: d.file_name })
    .catch((err) => toast.error(err?.message || 'The document could not be opened.'));

  return (
    <div className="panel-pad stack">
      {canWrite && (
        <form onSubmit={send} aria-label="Upload a document" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group"><label className="form-label" htmlFor="doc-file">File (PDF, PNG or JPEG)</label>
            <input id="doc-file" type="file" accept="application/pdf,image/png,image/jpeg" className="form-input" onChange={(e) => setFile(e.target.files[0] || null)} required /></div>
          <div className="form-group"><label className="form-label" htmlFor="doc-type">Document type</label>
            <select id="doc-type" className="form-select" value={docType} onChange={(e) => setDocType(e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          <button type="submit" className="btn btn-primary btn-md" disabled={!file || busy}><Upload size={16} aria-hidden="true" /> Upload</button>
          <p className="form-hint" style={{ flexBasis: '100%' }}><Lock size={12} aria-hidden="true" /> Stored encrypted. Each file is checked before it can be opened.</p>
        </form>
      )}
      {error && <p className="alert-strip alert-danger" role="alert">{error} This does not mean the patient has no documents.</p>}
      {docs && !docs.length && !error && <EmptyState icon={FileText} title="No documents uploaded yet" description="Scans and files attached to this patient appear here." />}
      {docs && docs.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="mini-table">
            <thead><tr><th>Type</th><th>File</th><th>Uploaded</th><th>State</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td><span className="tag">{d.doc_type || 'File'}</span></td>
                  <td>{d.file_name}<div className="cell-secondary">{d.size_bytes ? size(Number(d.size_bytes)) : ''}{d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ''}</div></td>
                  <td className="tabular">{fmt(d.uploaded_at)}<div className="cell-secondary">Kept until {d.retain_until ? new Date(d.retain_until).toLocaleDateString('en-IN') : '—'}</div></td>
                  <td>
                    {d.state ? <span className={`status ${TONE[d.state] || 'status-neutral'}`}>{d.state}</span> : <span className="status status-neutral">Old entry, no file</span>}
                    {d.legal_hold && <div className="cell-secondary"><ShieldAlert size={12} aria-hidden="true" /> Legal hold</div>}
                    {d.scan?.detail && <div className="cell-secondary">{d.scan.detail}</div>}
                    {d.withdrawn_reason && <div className="cell-secondary">Withdrawn: {d.withdrawn_reason}</div>}
                  </td>
                  <td className="text-right"><span className="inline-actions">
                    {d.state === 'Available' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => open(d)} aria-label={`Download ${d.file_name}`}>Download</button>}
                    {canWrite && d.state && d.state !== 'Withdrawn' && !d.legal_hold && <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                      const reason = window.prompt('Why is this document withdrawn? (it stays in the record)');
                      if (reason && reason.trim().length >= 5) act(`${d.id}/withdraw`, { reason }, 'Document withdrawn');
                    }}>Withdraw</button>}
                    {isAdmin && d.state && <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                      const reason = window.prompt(d.legal_hold ? 'Why is the legal hold lifted?' : 'Why is this document placed on legal hold?');
                      if (reason && reason.trim().length >= 5) act(`${d.id}/legal-hold`, { hold: !d.legal_hold, reason }, d.legal_hold ? 'Legal hold lifted' : 'Legal hold placed');
                    }}>{d.legal_hold ? 'Lift hold' : 'Legal hold'}</button>}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
