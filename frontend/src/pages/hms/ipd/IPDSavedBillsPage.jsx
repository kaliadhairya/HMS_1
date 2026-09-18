import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';

export default function IPDSavedBillsPage() {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/ipd/billing/saved-drafts')
      .then(res => setDrafts(res.data.data || []))
      .catch(() => toast.error('Failed to load saved drafts'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Navbar />
      <div className="container py-4" style={{ maxWidth: '1200px' }}>
        {/* Header */}
        <div className="hms-page-header" style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1 style={{ display: 'flex', alignItems: 'center', gap: 16, margin: 0 }}>
                <span className="header-icon" style={{ 
                  background: 'rgba(99,102,241,0.1)', 
                  borderColor: 'rgba(99,102,241,0.25)',
                  fontSize: '1.5rem',
                  width: 54, height: 54
                }}>📝</span>
                Saved Billing Drafts
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginTop: 8, marginLeft: 70 }}>
                Manage and finalize IPD bills that have been saved as drafts.
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => navigate('/ipd/billing')}>
              New Bill Entry
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
            <div className="spinner" style={{ width: 40, height: 40 }} />
          </div>
        ) : drafts.length === 0 ? (
          <div className="card" style={{ padding: '80px 40px', textAlign: 'center', borderRadius: 24 }}>
            <div style={{ fontSize: '4rem', marginBottom: 24, opacity: 0.2 }}>📄</div>
            <h3 style={{ color: 'var(--text-primary)', marginBottom: 12, fontSize: '1.5rem' }}>No Saved Drafts</h3>
            <p style={{ color: 'var(--text-secondary)', maxWidth: 400, margin: '0 auto' }}>
              You haven't saved any billing drafts yet. Start by adding items to an active admission in IPD Billing.
            </p>
            <button className="btn btn-outline" style={{ marginTop: 32 }} onClick={() => navigate('/ipd/billing')}>
              Go to Billing List
            </button>
          </div>
        ) : (
          <div className="hms-anim-1" style={{ display: 'grid', gap: 16 }}>
            {drafts.map(draft => (
              <div key={draft.ID} className="card hms-anim-1" style={{ 
                padding: '20px 28px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                transition: 'all 0.2s ease',
                border: '1px solid var(--border)',
                background: 'var(--surface-color)'
              }}>
                <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                  <div style={{ 
                    width: 56, height: 56, borderRadius: '50%', 
                    background: 'var(--surface-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.5rem'
                  }}>👤</div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>{draft.PATIENT_NAME}</h3>
                    <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      <span>{draft.UHID}</span>
                      <span>•</span>
                      <span>{draft.WARD_NAME} (Bed: {draft.BED_NUMBER})</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 48, alignItems: 'center' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.05em' }}>Draft Total</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary-color)', marginTop: 2 }}>
                      ₹{draft.draftTotal?.toLocaleString()}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{draft.itemCount} items added</div>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button className="btn btn-outline" onClick={() => navigate(`/ipd/billing/${draft.ID}`)}>
                      Edit Items
                    </button>
                    <button className="btn btn-primary" onClick={() => navigate(`/ipd/billing/${draft.ID}`)}>
                      Finalize Bill
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
