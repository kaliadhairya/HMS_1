import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

export default function DoctorClinicalNotesPage() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');

  useEffect(() => {
    api.get('/doctor/clinical-notes')
      .then(res => setNotes(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = notes.filter(n => {
    if (filterType && n.type !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (n.patient || '').toLowerCase().includes(q) || String(n.id).includes(q);
    }
    return true;
  });

  const noteTypeColors = {
    'SOAP Note': { bg: 'rgba(59,130,246,0.1)', color: '#2563eb', border: 'rgba(59,130,246,0.2)' },
    'Progress Note': { bg: 'rgba(16,185,129,0.1)', color: '#059669', border: 'rgba(16,185,129,0.2)' },
    'Discharge Summary': { bg: 'rgba(245,158,11,0.1)', color: '#d97706', border: 'rgba(245,158,11,0.2)' },
    'Operative Note': { bg: 'rgba(139,92,246,0.1)', color: '#7c3aed', border: 'rgba(139,92,246,0.2)' },
  };

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon">📄</span>
              Clinical Notes
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Centralized log of SOAP notes, progress notes, and discharge summaries.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-ghost" disabled title="Notes are created through the consultation encounter workflow.">
              Use Consultation
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="hms-filter-bar hms-anim-2">
          <div style={{ flex: 1 }}>
            <input type="text" className="form-input" placeholder="🔍 Search by Patient Name or Note ID..."
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <select className="form-input" value={filterType} onChange={e => setFilterType(e.target.value)} style={{ width: 220 }}>
            <option value="">All Note Types</option>
            <option>SOAP Note</option>
            <option>Progress Note</option>
            <option>Discharge Summary</option>
            <option>Operative Note</option>
          </select>
          <span style={{
            padding: '5px 14px', borderRadius: 20,
            background: 'var(--green-light)', color: 'var(--green)',
            fontSize: '0.78rem', fontWeight: 700, border: '1px solid var(--green-border)',
          }}>
            {filtered.length} notes
          </span>
        </div>

        {/* Table */}
        <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60, gap: 12 }}>
              <div className="spinner" style={{ width: 28, height: 28 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading clinical notes...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="hms-empty-state" style={{ margin: 24, border: 'none' }}>
              <span className="empty-icon">📝</span>
              <h3>No Clinical Notes</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                {searchQuery ? `No notes matching "${searchQuery}".` : 'No encounter notes have been recorded yet.'}
              </p>
            </div>
          ) : (
            <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Note ID</th><th>Patient</th>
                    <th>Note Type</th><th>Preview</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((note, idx) => {
                    const tc = noteTypeColors[note.type] || noteTypeColors['SOAP Note'];
                    return (
                      <tr key={idx}>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{new Date(note.date).toLocaleDateString()}</td>
                        <td><strong style={{ color: 'var(--blue)' }}>{note.id}</strong></td>
                        <td style={{ fontWeight: 600 }}>{note.patient}</td>
                        <td>
                          <span style={{
                            padding: '3px 10px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700,
                            background: tc.bg, color: tc.color, border: `1px solid ${tc.border}`,
                          }}>
                            {note.type}
                          </span>
                        </td>
                        <td style={{ maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-secondary)', fontSize: '0.83rem' }}>
                          {note.snippet}
                        </td>
                        <td>
                          <button className="btn btn-sm btn-ghost" disabled title="Open the consultation encounter to review the full note.">
                            Encounter Source
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
