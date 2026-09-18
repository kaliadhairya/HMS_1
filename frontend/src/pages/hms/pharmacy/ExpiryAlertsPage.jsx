import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';

export default function ExpiryAlertsPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(30);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [actionType, setActionType] = useState('return'); // return, discard, quarantine
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [reason, setReason] = useState('');
  const [quantity, setQuantity] = useState(0);

  useEffect(() => {
    fetchExpiring(activeTab);
  }, [activeTab]);

  const fetchExpiring = async (days) => {
    try {
      setLoading(true);
      const res = await api.get(`/pharmacy/stock/expiring?days=${days}`);
      const enriched = (res.data.data || []).map(d => ({
        ...d,
        isQuarantined: d.isQuarantined || false
      }));
      setData(enriched);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load expiry alerts.');
    } finally {
      setLoading(false);
    }
  };

  const openActionModal = (batch, type) => {
    setSelectedBatch(batch);
    setActionType(type);
    setQuantity(batch.QUANTITY);
    setReason('');
    setIsModalOpen(true);
  };

  const handleActionSubmit = async (e) => {
    e.preventDefault();
    try {
      if (quantity <= 0 || quantity > selectedBatch.QUANTITY) {
        return toast.error('Invalid quantity.');
      }
      if (actionType === 'discard' && !reason.trim()) {
        return toast.error('Disposal reason and witness approval required.');
      }

      // Simulate API Call
      toast.success(`Stock successfully ${actionType === 'quarantine' ? 'quarantined' : actionType === 'return' ? 'returned to supplier' : 'marked for destruction'}.`);
      setIsModalOpen(false);
      fetchExpiring(activeTab);
    } catch (err) {
      console.error(err);
      toast.error(`Failed to process ${actionType}.`);
    }
  };

  return (
    <>
    <Navbar />
    <div className="page-wrapper fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2>⏰ Expiry & Short-Dated Items</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Manage expiring stock, quarantines, vendor returns, and destruction logs.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {[7, 30, 90].map(days => (
          <button 
            key={days}
            className={`btn ${activeTab === days ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setActiveTab(days)}
          >
            Expiring in {days} Days
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 24 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
        ) : (
          <div className="table-wrapper">
          <table className="table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Batch / Expiry</th>
                <th>Status</th>
                <th>Qty</th>
                <th>Supplier</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map(item => {
                const isCritical = new Date(item.EXPIRY_DATE) - new Date() <= 7 * 24 * 60 * 60 * 1000;
                const isExpired = new Date(item.EXPIRY_DATE) - new Date() < 0;

                return (
                  <tr key={item.BATCH_ID} style={{ background: isExpired ? 'rgba(239, 68, 68, 0.1)' : isCritical ? 'rgba(245, 158, 11, 0.1)' : 'transparent' }}>
                    <td>
                      <strong>{item.GENERIC_NAME}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.STRENGTH}</div>
                    </td>
                    <td>
                      <code>{item.BATCH_NUMBER}</code>
                      <div style={{ color: isCritical || isExpired ? 'var(--red)' : 'inherit', fontWeight: isCritical || isExpired ? 600 : 400, fontSize: '0.85rem', marginTop: 4 }}>
                        {new Date(item.EXPIRY_DATE).toLocaleDateString()}
                      </div>
                    </td>
                    <td>
                      {isExpired ? <span className="badge badge-red">EXPIRED</span> : isCritical ? <span className="badge badge-amber">CRITICAL</span> : <span className="badge badge-blue">WARNING</span>}
                      {item.isQuarantined && <span className="badge" style={{ background: '#7e22ce', color: '#fff', marginLeft: 6 }}>QUARANTINED</span>}
                    </td>
                    <td style={{ fontWeight: 600, fontSize: '1.05rem' }}>{item.QUANTITY || 0}</td>
                    <td style={{ fontSize: '0.85rem' }}>{item.SUPPLIER_NAME}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button className="btn btn-sm btn-outline" style={{ color: 'var(--green-mid)', borderColor: 'var(--green-mid)' }} onClick={() => openActionModal(item, 'return')}>Return</button>
                        <button className="btn btn-sm btn-outline" style={{ color: '#7e22ce', borderColor: '#7e22ce' }} onClick={() => openActionModal(item, 'quarantine')}>Quarantine</button>
                        <button className="btn btn-sm btn-outline" style={{ color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => openActionModal(item, 'discard')}>Disposal</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {data.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    No items expiring within {activeTab} days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20
        }}>
          <div className="card" style={{ width: 500, padding: 32, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' }}>
            <h2 style={{ marginBottom: 20, textTransform: 'capitalize', color: actionType === 'discard' ? 'var(--red)' : actionType === 'quarantine' ? '#7e22ce' : 'var(--green-mid)' }}>
              {actionType === 'discard' ? 'Disposal & Destruction' : actionType === 'quarantine' ? 'Quarantine Stock' : 'Vendor Return'}
            </h2>
            
            <div style={{ background: 'var(--surface-2)', padding: '16px 20px', borderRadius: 8, marginBottom: 24, borderLeft: '4px solid var(--primary)' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--primary)' }}>{selectedBatch?.GENERIC_NAME}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                <span>Batch: <code style={{ color: '#fff' }}>{selectedBatch?.BATCH_NUMBER}</code></span>
                <span>Available Qty: <strong style={{ color: '#fff' }}>{selectedBatch?.QUANTITY}</strong></span>
              </div>
            </div>

            <form onSubmit={handleActionSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Quantity to {actionType}</label>
                <input 
                  required type="number" min="1" max={selectedBatch?.QUANTITY}
                  value={quantity} onChange={e => setQuantity(e.target.value)} 
                  className="form-input" style={{ width: '100%', fontSize: '1.1rem' }} 
                />
              </div>

              {(actionType === 'discard' || actionType === 'quarantine') && (
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Reason / Notes *</label>
                  <textarea 
                    required rows="3"
                    placeholder="Provide detailed reason for audit trail..."
                    value={reason} onChange={e => setReason(e.target.value)} 
                    className="form-input" style={{ width: '100%', resize: 'vertical' }} 
                  />
                </div>
              )}
              
              {actionType === 'discard' && (
                <div style={{ padding: 12, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, color: 'var(--red)', fontSize: '0.85rem' }}>
                  ⚠️ Discarding stock requires witness approval per compliance regulations. The record will be permanently logged in the destruction register.
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn" style={{ 
                  background: actionType === 'discard' ? 'var(--red)' : actionType === 'quarantine' ? '#7e22ce' : 'var(--green-mid)',
                  color: '#fff', padding: '12px 24px', fontWeight: 600
                }}>
                  Confirm {actionType}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
