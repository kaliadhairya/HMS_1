import { useState, useEffect } from 'react';
import Navbar from '../../../components/Navbar';
import api from '../../../api/axios';
import toast from 'react-hot-toast';

export default function NoticesPage() {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', message: '', department: 'All', priority: 'normal' });

  const load = () => {
    setLoading(true);
    api.get('/admin/notices')
      .then(r => setNotices(r.data.data))
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.title || !form.message) return toast.error('Fill all fields');
    try {
      await api.post('/admin/notices', form);
      setForm({ title: '', message: '', department: 'All', priority: 'normal' });
      setShowForm(false);
      toast.success('Notice published');
      load();
    } catch { toast.error('Failed'); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this notice?')) return;
    try { await api.delete(`/admin/notices/${id}`); load(); } catch { toast.error('Failed'); }
  };

  const priorityColor = { info: 'var(--blue)', normal: 'var(--green)', urgent: '#fbbf24', critical: '#ef4444' };

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Premium Header */}
        <div className="hms-page-header hms-anim-1" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(234,179,8,0.1)', borderColor: 'rgba(234,179,8,0.25)' }}>📢</span>
              Notices & Communication
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Department-level announcements, internal circulars, and notice board
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)} style={{ padding: '0 20px', height: 42 }}>
            <span style={{ fontSize: '1.2rem', marginRight: 6 }}>+</span> New Notice
          </button>
        </div>

        {showForm && (
          <div className="card hms-anim-2" style={{ marginBottom: 30, padding: 24, borderTop: '4px solid var(--blue)', boxShadow: 'var(--shadow-md)' }}>
            <h3 style={{ marginBottom: 20, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.2rem' }}>📝</span> Create Notice
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Title <span style={{ color: '#ef4444' }}>*</span></label>
                <input className="form-input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. OPD Timing Change" style={{ padding: '10px 14px' }} />
              </div>
              <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Message <span style={{ color: '#ef4444' }}>*</span></label>
                <textarea className="form-textarea" value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} rows={4} placeholder="Detailed message..." style={{ padding: '12px 14px' }} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Target Department</label>
                <select className="form-select" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} style={{ padding: '10px 14px' }}>
                  <option>All</option>
                  <option>OPD</option>
                  <option>IPD</option>
                  <option>Lab</option>
                  <option>Pharmacy</option>
                  <option>Nursing</option>
                  <option>Front Desk</option>
                  <option>Billing</option>
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Priority Level</label>
                <select className="form-select" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={{ padding: '10px 14px' }}>
                  <option value="info">Info (Blue)</option>
                  <option value="normal">Normal (Green)</option>
                  <option value="urgent">Urgent (Yellow)</option>
                  <option value="critical">Critical (Red)</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: 24, display: 'flex', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button className="btn btn-primary" onClick={create} style={{ padding: '0 24px' }}>📤 Publish Notice</button>
              <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
        ) : notices.length === 0 ? (
          <div className="card hms-anim-3" style={{ textAlign: 'center', padding: 60, background: 'var(--surface-2)', border: '1px dashed var(--border)', borderRadius: 16 }}>
            <div style={{ fontSize: '4rem', marginBottom: 16, filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}>📭</div>
            <h3 style={{ fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: 8 }}>No Notices</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>Create your first notice to communicate with departments across the hospital.</p>
          </div>
        ) : (
          <div className="hms-anim-3" style={{ display: 'grid', gap: 16 }}>
            {notices.map((n, i) => (
              <div key={n.id} className="card hms-table-anim" style={{
                borderLeft: `5px solid ${priorityColor[n.priority] || 'var(--border)'}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: 20, transition: 'transform 0.2s, box-shadow 0.2s',
                animationDelay: `${i * 0.05}s`
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}>{n.title}</span>
                    <span className="badge" style={{ background: 'var(--surface-3)', fontSize: '0.75rem', padding: '4px 10px', color: 'var(--text-secondary)' }}>{n.department}</span>
                    {n.priority === 'urgent' && <span className="badge badge-amber" style={{ padding: '4px 10px' }}>Urgent</span>}
                    {n.priority === 'critical' && <span className="badge badge-red" style={{ padding: '4px 10px' }}>Critical</span>}
                  </div>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>{n.message}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    <span style={{ background: 'var(--surface-2)', padding: '4px 8px', borderRadius: 4 }}>👤 By {n.created_by}</span>
                    <span>•</span>
                    <span>🕒 {new Date(n.created_at).toLocaleString('en-IN')}</span>
                  </div>
                </div>
                <button 
                  className="btn btn-ghost" 
                  onClick={() => remove(n.id)} 
                  style={{ color: '#ef4444', flexShrink: 0, padding: 8, height: 'auto', background: 'rgba(239,68,68,0.1)' }}
                  title="Delete Notice"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
