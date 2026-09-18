import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import { toast } from 'react-hot-toast';

export default function LabResultsEntryPage() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [resultValue, setResultValue] = useState('');
  const [remarks, setRemarks] = useState('');

  const loadPending = async () => {
    try {
      const res = await api.get('/lab/results');
      setPending(res.data.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load pending results');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPending();
  }, []);

  useEffect(() => {
    setResultValue(selected?.currentResult || '');
    setRemarks(selected?.remarks || '');
  }, [selected]);

  const handleSubmit = async () => {
    if (!selected) return;
    if (!resultValue.trim()) {
      toast.error('Observed value is required');
      return;
    }

    try {
      await api.post(`/lab/results/${selected.id}`, {
        result_value: resultValue.trim(),
        remarks: remarks.trim(),
      });
      toast.success('Result submitted successfully');
      setSelected(null);
      setResultValue('');
      setRemarks('');
      setLoading(true);
      loadPending();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save result');
    }
  };

  return (
    <>
      <Navbar />
      <div className="container py-4">
        <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1>📝 Results Entry</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Core lab work. Enter values, check against reference ranges, and auto-flag abnormal results.</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          {/* Left: Pending List */}
          <div className="card fade-up-2" style={{ flex: '0 0 350px', padding: 16 }}>
            <h3 style={{ marginBottom: 16, fontSize: '1.1rem' }}>Pending Entry List</h3>
            {loading ? <div className="spinner" /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pending.map(p => (
                  <div
                    key={p.id}
                    onClick={() => setSelected(p)}
                    style={{
                      padding: 12, borderRadius: 8, cursor: 'pointer',
                      border: selected?.id === p.id ? '2px solid var(--primary)' : '1px solid var(--border)',
                      background: selected?.id === p.id ? 'var(--primary-light)' : 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{p.patient}</span>
                      {p.priority === 'STAT' && <span className="badge badge-red">STAT</span>}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {p.test} · Barcode: {p.sampleBarcode}
                    </div>
                  </div>
                ))}
              </div>
            )}
           </div>

          {/* Right: Entry Form */}
          <div className="card fade-up-3" style={{ flex: 1, padding: 24, minHeight: 400 }}>
            {!selected ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                Select a pending test from the list to enter results.
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 20 }}>
                  <div>
                    <h2 style={{ marginBottom: 4 }}>{selected.test}</h2>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Patient: {selected.patient} ({selected.uhid}) · Ordered by: {selected.orderedBy}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>Ref Barcode</div>
                    <code style={{ background: 'var(--surface-3)', padding: '4px 8px', borderRadius: 4 }}>{selected.sampleBarcode}</code>
                  </div>
                </div>

                <div className="table-wrapper" style={{ marginBottom: 24 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Test</th>
                        <th>Observed Value</th>
                        <th>Sample Barcode</th>
                        <th>Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ fontWeight: 500 }}>{selected.test}</td>
                        <td>
                          <input
                            type="text"
                            className="form-input"
                            style={{ width: 220, padding: '6px 10px' }}
                            placeholder="Enter measured value"
                            value={resultValue}
                            onChange={(e) => setResultValue(e.target.value)}
                          />
                        </td>
                        <td>{selected.sampleBarcode}</td>
                        <td>
                          <span className={`badge ${selected.priority === 'STAT' ? 'badge-red' : selected.priority === 'Urgent' ? 'badge-amber' : 'badge-green'}`}>
                            {selected.priority || 'Routine'}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div style={{ marginBottom: 24 }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 8 }}>Lab Technician Remarks</label>
                  <textarea
                    className="form-input"
                    rows="3"
                    placeholder="Enter findings, specimen notes, or anomalies..."
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                  <button className="btn btn-outline" onClick={() => setSelected(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleSubmit}>
                    ✓ Submit for Printing
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
