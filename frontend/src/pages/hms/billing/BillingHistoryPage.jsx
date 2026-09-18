import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';

export default function BillingHistoryPage() {
  const { patientId } = useParams();
  const [bills, setBills] = useState([]);
  const [advance, setAdvance] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [billsRes, advRes] = await Promise.all([
          api.get(`/billing/patient/${patientId}`),
          api.get(`/billing/advance/${patientId}`)
        ]);
        setBills(billsRes.data.data);
        setAdvance(advRes.data.data);
      } catch (err) {
        toast.error('Failed to load billing history');
      } finally {
        setLoading(false);
      }
    };
    if (patientId) fetchData();
  }, [patientId]);

  if (loading) return <div>Loading records...</div>;

  return (
    <>
    <Navbar />
    <div className="page-wrapper fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2>Patient Financial Ledger</h2>
        {advance && (
          <div className="card" style={{ padding: '12px 24px', background: 'var(--surface-color)', display: 'flex', gap: 24 }}>
             <div>
               <small style={{ color: 'var(--text-secondary)' }}>Advance Deposited</small>
               <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>₹{advance.totalAdvance}</div>
             </div>
             <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 24 }}>
               <small style={{ color: 'var(--text-secondary)' }}>Available Balance</small>
               <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>₹{advance.availableAdvance}</div>
             </div>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 24 }}>
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: 16 }}>Date</th>
              <th style={{ padding: 16 }}>Bill No.</th>
              <th style={{ padding: 16 }}>Type</th>
              <th style={{ padding: 16 }}>Total Amount</th>
              <th style={{ padding: 16 }}>Paid</th>
              <th style={{ padding: 16 }}>Status</th>
              <th style={{ padding: 16 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {bills.length === 0 ? (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: 24 }}>No bills generated yet.</td></tr>
            ) : (
              bills.map(b => (
                <tr key={b.ID} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 16 }}>{new Date(b.CREATED_AT).toLocaleDateString()}</td>
                  <td style={{ padding: 16 }}><strong>{b.BILL_NUMBER}</strong></td>
                  <td style={{ padding: 16 }}>{b.BILL_TYPE}</td>
                  <td style={{ padding: 16 }}>₹{b.NET_PAYABLE}</td>
                  <td style={{ padding: 16, color: 'var(--blue)' }}>₹{b.PAID_AMOUNT || 0}</td>
                  <td style={{ padding: 16 }}>
                    <span className="badge" style={{
                      background: b.STATUS === 'Paid' ? '#48bb7820' : b.STATUS === 'Pending' ? '#ecc94b20' : '#4299e120',
                      color: b.STATUS === 'Paid' ? '#48bb78' : b.STATUS === 'Pending' ? '#d69e2e' : '#4299e1',
                      padding: '4px 8px', borderRadius: 12, fontSize: '0.85rem'
                    }}>{b.STATUS}</span>
                  </td>
                  <td style={{ padding: 16 }}>
                    {b.BILL_TYPE === 'OPD' && b.ENCOUNTER_ID && (
                       <Link to={`/billing/opd/${b.ENCOUNTER_ID}`} className="btn btn-outline" style={{ fontSize: '0.85rem', padding: '6px 12px' }}>
                          View / Pay
                       </Link>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}
