import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../../components/Navbar';
import api from '../../../api/axios';
import toast from 'react-hot-toast';

export default function RestFormHubPage() {
  const [restForms, setRestForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const loadRestForms = async () => {
    try {
      const res = await api.get('/hms/rest-forms/doctor');
      setRestForms(res.data);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load rest forms');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRestForms();
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this rest form?')) return;
    try {
      await api.delete(`/hms/rest-forms/${id}`);
      toast.success('Rest form deleted');
      loadRestForms();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete rest form');
    }
  };

  const filteredForms = restForms.filter(f => 
    (f.patient_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (f.emp_number || '').includes(searchQuery) ||
    (f.book_no || '').includes(searchQuery)
  );

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon">🛏️</span>
              Rest Forms Hub
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Manage patient rest and light duty certification forms.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={() => navigate('/doctor/rest-forms/new')}>
              + Create Rest Form
            </button>
          </div>
        </div>

        {/* Summary + Search */}
        <div className="hms-anim-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div className="hms-stat-card" style={{ padding: 18, borderLeft: '4px solid #8b5cf6', cursor: 'default', display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>📋</div>
            <div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.08em' }}>Total Rest Forms</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{restForms.length}</div>
            </div>
          </div>
          <div className="card" style={{
            padding: '10px 18px', borderRadius: 40,
            display: 'flex', alignItems: 'center', gap: 12,
            border: '2px solid var(--border)', transition: 'border-color 0.3s ease',
          }}
          onFocusCapture={e => e.currentTarget.style.borderColor = 'var(--green)'}
          onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <span style={{ fontSize: '1.1rem', filter: 'grayscale(0.5)' }}>🔍</span>
            <input
              type="text"
              className="form-input"
              style={{ border: 'none', boxShadow: 'none', background: 'transparent', padding: '8px 0', flex: 1 }}
              placeholder="Search by Patient, Emp No, or Book No..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Table */}
        <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60, gap: 12 }}>
              <div className="spinner" style={{ width: 28, height: 28 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading rest forms...</span>
            </div>
          ) : filteredForms.length === 0 ? (
            <div className="hms-empty-state" style={{ margin: 24, border: 'none' }}>
              <span className="empty-icon">📝</span>
              <h3>{searchQuery ? 'No Results' : 'No Rest Forms'}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                {searchQuery ? `No forms matching "${searchQuery}".` : 'No rest forms have been generated yet.'}
              </p>
            </div>
          ) : (
            <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Patient</th><th>Emp No</th>
                    <th>Book No</th><th>Sr No</th><th>Disease</th>
                    <th>Days</th><th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredForms.map(f => (
                    <tr key={f.id}>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{new Date(f.created_at).toLocaleDateString('en-GB')}</td>
                      <td style={{ fontWeight: 700 }}>{f.patient_name}</td>
                      <td style={{ color: 'var(--green)', fontWeight: 500 }}>{f.emp_number || 'N/A'}</td>
                      <td>{f.book_no || '-'}</td>
                      <td>{f.sr_no || '-'}</td>
                      <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: '0.83rem' }}>
                        {f.disease || '-'}
                      </td>
                      <td>
                        <span style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700,
                          background: 'rgba(139,92,246,0.1)', color: '#7c3aed', border: '1px solid rgba(139,92,246,0.2)',
                        }}>
                          {f.advised_days || '-'} days
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button className="btn btn-sm btn-blue" onClick={() => navigate(`/doctor/rest-forms/print/${f.id}`)}>
                            🖨️ Print
                          </button>
                          <button className="btn btn-sm btn-outline" onClick={() => navigate(`/doctor/rest-forms/edit/${f.id}`)}>
                            ✏️ Edit
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDelete(f.id)}>
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
