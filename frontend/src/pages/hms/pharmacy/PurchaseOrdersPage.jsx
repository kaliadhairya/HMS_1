import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // keeping endpoint same as requested, but we map the UI to PR
    api.get('/pharmacist_lms/purchase-orders')
      .then(res => setPos(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Navbar />
      <div className="container py-4">
        <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1>📋 Purchase Requests</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Raise indents to suppliers, track approvals, and link to GRN.</p>
          </div>
          <button 
            className="btn btn-primary" 
            style={{ background: 'var(--blue)', borderColor: 'var(--blue)' }}
            onClick={() => navigate('/hms/pharmacy/raise-indent')}
          >
            + Raise Indent (PR)
          </button>
        </div>

        {loading ? <div className="spinner" /> : (
          <div className="card fade-up-2" style={{ padding: 24 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>PR Number</th>
                    <th>Date Raised</th>
                    <th>Supplier</th>
                    <th>PR Value</th>
                    <th>Expected Delivery</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map(po => (
                    <tr key={po.id}>
                      <td><strong>{po.id}</strong></td>
                      <td>{po.date}</td>
                      <td style={{ fontWeight: 500 }}>{po.supplier}</td>
                      <td>{po.value}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{po.expectedDelivery}</td>
                      <td>
                        <span className={`badge ${po.status === 'Delivered' ? 'badge-green' : po.status === 'Pending Approval' ? 'badge-amber' : 'badge-blue'}`}>
                          {po.status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-sm btn-outline">View</button>
                          {po.status !== 'Delivered' && (
                            <button className="btn btn-sm" style={{ background: 'var(--green)', color: '#fff' }} onClick={() => navigate('/hms/pharmacy/grn')}>GRN</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
