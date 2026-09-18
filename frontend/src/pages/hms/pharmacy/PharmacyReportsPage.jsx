import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

export default function PharmacyReportsPage() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/pharmacist_lms/reports')
      .then(res => setReport(res.data.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Navbar />
      <div className="container py-4">
        <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1>📊 Pharmacy Operations Reports</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Daily sales, stock valuation, and slow-moving item tracking.</p>
          </div>
          <button className="btn btn-outline">🖨️ Export PDF</button>
        </div>

        {loading ? <div className="spinner" /> : report && (
          <div className="fade-up-2">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
              <div className="card" style={{ padding: 20 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Daily Sales (OTC+IPD)</div>
                <div style={{ fontSize: '2.2rem', fontWeight: 700, color: 'var(--green-mid)', margin: '8px 0' }}>{report.dailySales}</div>
              </div>
              <div className="card" style={{ padding: 20 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Items Dispensed</div>
                <div style={{ fontSize: '2.2rem', fontWeight: 700, color: 'var(--blue)', margin: '8px 0' }}>{report.totalDispensed}</div>
              </div>
              <div className="card" style={{ padding: 20 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Est. Inventory Value</div>
                <div style={{ fontSize: '2.2rem', fontWeight: 700, margin: '8px 0' }}>{report.inventoryValue}</div>
              </div>
              <div className="card" style={{ padding: 20, background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                <div style={{ fontSize: '0.85rem', color: '#ef4444', textTransform: 'uppercase' }}>Active Stock Alerts</div>
                <div style={{ fontSize: '2.2rem', fontWeight: 700, color: '#ef4444', margin: '8px 0' }}>{report.stockAlerts}</div>
              </div>
            </div>

            <div className="card fade-up-3" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 16 }}>Slow-Moving Inventory Alert</h3>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Medicine Name</th>
                      <th>Current Stock</th>
                      <th>Last Dispensed</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.slowMoving.map((item, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{item.name}</td>
                        <td>{item.stock} units</td>
                        <td style={{ color: 'var(--amber)' }}>{item.lastMoved}</td>
                        <td><button className="btn btn-sm btn-outline">Review / Return</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
