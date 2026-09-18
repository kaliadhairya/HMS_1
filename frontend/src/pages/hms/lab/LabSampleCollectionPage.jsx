import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import { toast } from 'react-hot-toast';

export default function LabSampleCollectionPage() {
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/lab/samples')
      .then(res => setSamples(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const refreshSamples = async () => {
    try {
      const res = await api.get('/lab/samples');
      setSamples(res.data.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reload samples');
    }
  };

  const handleLogSample = async (sample) => {
    if (!sample?.itemId) return;
    try {
      await api.post('/lab/samples', { itemId: sample.itemId });
      toast.success(`Sample logged for ${sample.patient}`);
      refreshSamples();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to log sample');
    }
  };

  return (
    <>
      <Navbar />
      <div className="container py-4">
        <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1>🩸 Sample Collection</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Log sample collection times, assign barcodes, and track storage.</p>
          </div>
          <button className="btn btn-outline" onClick={refreshSamples}>↻ Refresh</button>
        </div>

        {loading ? <div className="spinner" /> : (
          <div className="card fade-up-2" style={{ padding: 24 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Sample ID</th>
                    <th>Barcode</th>
                    <th>Patient</th>
                    <th>Test Type</th>
                    <th>Sample Details</th>
                    <th>Collected At</th>
                    <th>Storage</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map(s => (
                    <tr key={s.id}>
                      <td><strong>{s.id}</strong></td>
                      <td>
                        <span style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>
                          {s.barcode}
                        </span>
                      </td>
                      <td style={{ fontWeight: 500 }}>{s.patient}</td>
                      <td style={{ fontSize: '0.85rem' }}>{s.tests}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{s.type}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>By: {s.collector}</div>
                      </td>
                      <td>{s.collectedAt}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{s.storage}</td>
                      <td>
                        <span className={`badge ${s.status === 'Pending Collection' ? 'badge-amber' : s.status === 'Received in Lab' ? 'badge-blue' : 'badge-green'}`}>
                          {s.status}
                        </span>
                      </td>
                      <td>
                        {s.status === 'Pending Collection' ? (
                          <button className="btn btn-sm btn-primary" onClick={() => handleLogSample(s)}>
                            Log Sample
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Logged</span>
                        )}
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
