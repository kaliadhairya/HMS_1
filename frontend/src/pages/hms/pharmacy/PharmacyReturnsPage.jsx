import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

export default function PharmacyReturnsPage() {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');

  useEffect(() => {
    api.get('/pharmacist_lms/returns')
      .then(res => setReturns(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filteredReturns = activeTab === 'All' 
    ? returns 
    : returns.filter(r => r.type.includes(activeTab));

  return (
    <>
      <Navbar />
      <div className="container py-4">
        <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1>↩️ Returns & Replacements</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Log patient returns (restocking) and vendor returns (credits).</p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-outline" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>+ Vendor Return</button>
            <button className="btn btn-primary">+ Patient Return</button>
          </div>
        </div>

        {loading ? <div className="spinner" /> : (
          <div className="card fade-up-2" style={{ padding: 24 }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              {['All', 'Patient', 'Vendor'].map(tab => (
                <button 
                  key={tab}
                  className={`btn btn-sm ${activeTab === tab ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab} Returns
                </button>
              ))}
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Return ID</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Entity Source</th>
                    <th>Items Returned</th>
                    <th>Reason</th>
                    <th>Credit Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReturns.map(r => (
                    <tr key={r.id}>
                      <td><strong>{r.id}</strong></td>
                      <td>{r.date}</td>
                      <td>
                        <span className={`badge ${r.type.includes('Vendor') ? 'badge-amber' : 'badge-blue'}`}>
                          {r.type}
                        </span>
                      </td>
                      <td style={{ fontWeight: 500 }}>{r.entity}</td>
                      <td style={{ fontSize: '0.85rem' }}>{r.items}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{r.reason}</td>
                      <td style={{ fontWeight: 600 }}>{r.value}</td>
                      <td>
                        <span style={{ fontSize: '0.8rem', color: r.status === 'Restocked' ? 'var(--green)' : 'var(--amber)' }}>
                          {r.status}
                        </span>
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
