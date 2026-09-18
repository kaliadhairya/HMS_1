import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../../components/Navbar';
import { useSocket } from '../../../context/SocketContext';
import { toast } from 'react-hot-toast';

export default function LabTestQueuePage() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const socket = useSocket();

  useEffect(() => {
    fetchQueue();
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on('new_lab_order', (data) => {
      console.log('⚡ New lab order received:', data);
      toast('New Investigation Order Received!', { icon: '🧪', duration: 4000 });
      fetchQueue();
    });

    return () => {
      socket.off('new_lab_order');
    };
  }, [socket]);

  const fetchQueue = async () => {
    try {
      const res = await api.get('/lab/queue');
      setQueue(res.data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const priorityStyles = {
    STAT: { bg: 'rgba(239,68,68,0.15)', color: '#ef4444', border: 'rgba(239,68,68,0.3)' },
    Urgent: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
    Routine: { bg: 'rgba(56,189,248,0.1)', color: '#38bdf8', border: 'rgba(56,189,248,0.2)' }
  };

  return (
    <>
      <Navbar />
      <div className="container py-4">
        <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1>🧪 Test Queue</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Live pending investigations ordered by doctors.</p>
          </div>
          <button className="btn btn-outline" onClick={fetchQueue}>↻ Refresh Queue</button>
        </div>

        {loading ? <div className="spinner" /> : (
          <div className="card fade-up-2" style={{ padding: 24 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Time</th>
                    <th>Patient</th>
                    <th>Priority</th>
                    <th>Tests Requested</th>
                    <th>Doctor / Dept</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map(order => {
                    const pStyle = priorityStyles[order.priority] || priorityStyles.Routine;
                    return (
                      <tr key={order.id}>
                        <td><strong>{order.id}</strong></td>
                        <td style={{ color: 'var(--text-muted)' }}>{order.time}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{order.patient}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{order.uhid}</div>
                        </td>
                        <td>
                          <span style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
                            background: pStyle.bg, color: pStyle.color, border: `1px solid ${pStyle.border}`
                          }}>
                            {order.priority}
                          </span>
                        </td>
                        <td>{order.tests.join(', ')}</td>
                        <td>
                          <div style={{ fontSize: '0.9rem' }}>{order.doctor}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{order.dept}</div>
                        </td>
                        <td>
                          <span className={`badge ${order.status === 'Pending' ? 'badge-amber' : 'badge-green'}`}>
                            {order.status}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-sm btn-primary" onClick={() => navigate('/lab/samples')}>
                            Log Sample
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {queue.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No pending orders. Queue is clear! 🎉</div>}
          </div>
        )}
      </div>
    </>
  );
}
