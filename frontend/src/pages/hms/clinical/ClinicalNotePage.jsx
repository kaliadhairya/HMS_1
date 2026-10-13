import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FilePen, Lock, Save } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';

const SECTIONS = [
  ['chiefComplaint', 'Chief complaint'],
  ['history', 'History'],
  ['examination', 'Examination'],
  ['assessment', 'Assessment'],
  ['plan', 'Plan'],
];

// A clinical note. Every save and signature states the version it is based on;
// if someone else changed the note meanwhile, the save is refused and the latest
// version is shown. Signing freezes the note; changes are linked amendments.
export default function ClinicalNotePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [noteId, setNoteId] = useState(id && id !== 'new' ? id : null);
  const [note, setNote] = useState(null);
  const [version, setVersion] = useState(null);
  const [content, setContent] = useState({});
  const [versions, setVersions] = useState([]);
  const [busy, setBusy] = useState(false);

  const applyResponse = (data, etag) => {
    setNote(data);
    setContent(data.content || {});
    setVersion(etag ? Number(etag.replace(/"/g, '')) : data.version);
  };

  const load = async (nid) => {
    try {
      const res = await api.get(`/clinical-documents/${nid}`);
      applyResponse(res.data.data, res.headers.etag);
      const v = await api.get(`/clinical-documents/${nid}/versions`);
      setVersions(v.data.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not load the note.');
    }
  };
  useEffect(() => { if (noteId) load(noteId); }, [noteId]);

  const failed = (err, fallback) => {
    const data = err.response?.data;
    if (err.response?.status === 412 && data?.current) {
      toast.error(`${data.message} Your text is still here to copy.`, { duration: 9000 });
      setVersion(data.current);
    } else {
      toast.error(data?.message || fallback, { duration: 7000 });
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const res = await api.post('/clinical-documents', { patientId: Number(params.get('patient')), content });
      setNoteId(String(res.data.data.id));
      applyResponse(res.data.data, res.headers.etag);
      navigate(`/hms/notes/${res.data.data.id}`, { replace: true });
      toast.success('Note started');
    } catch (err) {
      failed(err, 'Could not start the note.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.put(`/clinical-documents/${noteId}/draft`, { content }, { headers: { 'If-Match': `"${version}"` } });
      applyResponse(res.data.data, res.headers.etag);
      toast.success('Draft saved');
    } catch (err) {
      failed(err, 'Could not save the draft.');
    } finally {
      setBusy(false);
    }
  };

  const sign = async () => {
    if (!window.confirm('Sign this note? Signed content cannot be changed; later changes are linked amendments.')) return;
    setBusy(true);
    try {
      const res = await api.post(`/clinical-documents/${noteId}/sign`, undefined, { headers: { 'If-Match': `"${version}"` } });
      applyResponse(res.data.data, res.headers.etag);
      toast.success('Note signed');
      await load(noteId);
    } catch (err) {
      failed(err, 'Could not sign the note.');
    } finally {
      setBusy(false);
    }
  };

  const amend = async () => {
    const reason = window.prompt('Why are you amending this signed note? (at least 10 characters)');
    if (!reason || reason.trim().length < 10) return;
    setBusy(true);
    try {
      const res = await api.post(`/clinical-documents/${noteId}/amend`, { reason }, { headers: { 'If-Match': `"${version}"` } });
      applyResponse(res.data.data, res.headers.etag);
      setAmendReason(reason);
      toast.success('Amendment started. Edit, then sign it.');
    } catch (err) {
      failed(err, 'Could not start the amendment.');
    } finally {
      setBusy(false);
    }
  };

  const signAmendment = async () => {
    if (!amendReason) return;
    setBusy(true);
    try {
      const res = await api.post(`/clinical-documents/${noteId}/sign-amendment`, { reason: amendReason }, { headers: { 'If-Match': `"${version}"` } });
      applyResponse(res.data.data, res.headers.etag);
      setAmendReason(null);
      toast.success('Amendment signed');
      await load(noteId);
    } catch (err) {
      failed(err, 'Could not sign the amendment.');
    } finally {
      setBusy(false);
    }
  };

  const [amendReason, setAmendReason] = useState(null);
  const editable = !noteId || note?.state === 'draft';
  const signedOnce = note?.state === 'signed';

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title={noteId ? 'Clinical note' : 'New clinical note'} description={note ? `Version ${version} · ${note.state === 'signed' ? 'signed' : 'draft'}` : 'Notes are saved as drafts until you sign them.'} />
        <section className="panel panel-pad stack" style={{ maxWidth: 820, margin: '0 auto' }}>
          {SECTIONS.map(([key, label]) => (
            <div key={key} className="form-group">
              <label className="form-label" htmlFor={`note-${key}`}>{label}</label>
              <textarea id={`note-${key}`} className="form-input" rows={key === 'chiefComplaint' ? 2 : 4} maxLength={5000}
                value={content[key] || ''} disabled={!editable || busy} onChange={(e) => setContent({ ...content, [key]: e.target.value })} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!noteId && <button type="button" className="btn btn-primary btn-md" disabled={busy} onClick={create}><FilePen size={16} aria-hidden="true" /> Start note</button>}
            {noteId && editable && <button type="button" className="btn btn-secondary btn-md" disabled={busy} onClick={save}><Save size={16} aria-hidden="true" /> Save draft</button>}
            {noteId && editable && <button type="button" className="btn btn-primary btn-md" disabled={busy} onClick={sign}><Lock size={16} aria-hidden="true" /> Sign note</button>}
            {noteId && signedOnce && <button type="button" className="btn btn-ghost btn-md" disabled={busy} onClick={amend}>Amend</button>}
            {noteId && amendReason && <button type="button" className="btn btn-primary btn-md" disabled={busy} onClick={signAmendment}>Sign amendment</button>}
          </div>
          {versions.length > 0 && (
            <div>
              <h2 className="panel-subtitle">Signed versions</h2>
              <ul className="muted">
                {versions.map((v) => (
                  <li key={v.version}>Version {v.version} · {v.meaning} · {v.signed_by_name} · {new Date(v.signed_at).toLocaleString('en-IN')}
                    {v.amends_version ? ` · amends version ${v.amends_version}: ${v.amendment_reason}` : ''} · <span className="mono">{v.digest.slice(0, 12)}…</span></li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
