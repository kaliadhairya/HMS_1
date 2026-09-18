import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../../components/Navbar';

export default function InvestigationQueuePage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchQueue = async () => {
    try {
      const res = await api.get('/lab/queue');
      setOrders(res.data.data || []);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load ordered investigations');
    } finally {
      setLoading(false);
    }
  };

  const processTests = async (order) => {
    try {
      await api.patch(`/lab/queue/${order.id}`, { status: 'In Progress' });
      navigate('/lab/results');
      toast.success(`Moved ${order.patient} to results entry`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update lab queue');
    }
  };

  if (loading) return <><Navbar /><div className="page-wrapper"><h3>Loading Queue...</h3></div></>;

  return (
    <>
    <Navbar />
    <div className="page-wrapper fade-up">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Doctor Ordered Investigations</h2>
          <p>Lab tests ordered during doctor consultations</p>
        </div>
        <button className="btn btn-outline" onClick={fetchQueue}>↻ Refresh</button>
      </div>

      <div className="card">
        {orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🧪</div>
            <p>No pending laboratory orders at this time.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Order Time</th>
                  <th>Tests Ordered</th>
                  <th>Doctor</th>
                  <th>Urgency</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{o.patient}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>UHID: {o.uhid}</div>
                    </td>
                    <td>{o.time}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {o.tests?.map((item, idx) => (
                          <span key={idx} className="badge badge-blue">{item}</span>
                        ))}
                      </div>
                    </td>
                    <td>Dr. {o.doctor}</td>
                    <td>
                      <span className={`badge ${o.priority === 'STAT' ? 'badge-red' : o.priority === 'Urgent' ? 'badge-amber' : 'badge-green'}`}>
                        {o.priority}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-primary" onClick={() => processTests(o)}>Process Tests</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
