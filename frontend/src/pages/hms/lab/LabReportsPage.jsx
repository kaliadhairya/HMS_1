import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

export default function LabReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/lab/reports')
      .then(res => setReports(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Navbar />
      <div className="container py-4">
        <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1>📄 Final Lab Reports</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Generate PDF, print, or share results with doctors and patients.</p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <input type="text" className="form-input" placeholder="Search by Patient / Report ID" style={{ width: 250 }} />
            <button className="btn btn-outline">🔍 Search</button>
          </div>
        </div>

        {loading ? <div className="spinner" /> : (
          <div className="card fade-up-2" style={{ padding: 24 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Report ID</th>
                    <th>Time Generated</th>
                    <th>Patient</th>
                    <th>Test Name</th>
                    <th>Verified By</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r, i) => (
                    <tr key={r.id}>
                      <td><strong>{r.id}</strong></td>
                      <td style={{ color: 'var(--text-muted)' }}>{r.time}</td>
                      <td>{r.patient}</td>
                      <td>
                        <span style={{ fontWeight: 500 }}>{r.test}</span>
                        {r.flag === 'Critical' && <span style={{ marginLeft: 8, padding: '2px 6px', fontSize: '0.7rem', background: 'var(--red)', color: '#fff', borderRadius: 4 }}>CRIT</span>}
                      </td>
                      <td style={{ fontSize: '0.85rem' }}>{r.verifiedBy}</td>
                      <td>
                        <span className={`badge ${r.status === 'Final' ? 'badge-green' : 'badge-amber'}`}>{r.status}</span>
                        {r.printed && <span style={{ marginLeft: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>(Printed)</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-sm btn-primary" disabled={r.status !== 'Final'}>📄 PDF</button>
                          <button className="btn btn-sm" disabled={r.status !== 'Final'} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}>🖨️ Print</button>
                          <button className="btn btn-sm" disabled={r.status !== 'Final'} style={{ background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.2)', color: '#34d399' }} title="Send WhatsApp">💬</button>
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
