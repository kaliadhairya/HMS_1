import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext();
const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (user) {
      const newSocket = io(socketUrl, {
        withCredentials: true,
        auth: { token: localStorage.getItem('lab_token') },
      });

      newSocket.on('connect', () => {
        console.log('🔌 Connected to real-time server:', newSocket.id);
        // Join a room based on the user's role
        if (user.role) {
          newSocket.emit('join_role', user.role);
          console.log(`👤 Joined room: ${user.role}`);
        }
      });

      // Advanced notification for IPD admission requests (for nurses/admins)
      newSocket.on('new_ipd_request', (data) => {
        if (user.role === 'nurse' || user.role === 'super_admin' || user.role === 'admin') {
          // Play a "cling" sound using Web Audio API
          try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(1046.50, ctx.currentTime); // C6 note
            osc.frequency.exponentialRampToValueAtTime(1318.51, ctx.currentTime + 0.1); // E6 note chime

            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05); // Fast fade in
            gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0); // Smooth fade out

            osc.connect(gainNode);
            gainNode.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 1.0);
          } catch (e) {
            console.warn("Audio play failed:", e);
          }

          import('react-hot-toast').then(({ default: toast }) => {
            toast.custom((t) => (
              <div style={{
                maxWidth: 420, width: '100%',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
                display: 'flex', flexDirection: 'column',
                overflow: 'hidden',
                animation: t.visible ? 'notifDrop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards' : 'notifExit 0.3s ease-in forwards',
              }}>
                <style>{`
                  @keyframes notifDrop {
                    0% { transform: translateY(-80px) scale(0.95); opacity: 0; }
                    100% { transform: translateY(0) scale(1); opacity: 1; }
                  }
                  @keyframes notifExit {
                    0% { transform: translateY(0) scale(1); opacity: 1; }
                    100% { transform: translateY(-40px) scale(0.95); opacity: 0; }
                  }
                `}</style>
                <div style={{ 
                  padding: '12px 16px', background: 'rgba(59,130,246,0.08)',
                  borderBottom: '1px solid rgba(59,130,246,0.1)',
                  display: 'flex', alignItems: 'center', gap: 10
                }}>
                  <div style={{ 
                    width: 28, height: 28, borderRadius: 8, background: '#3b82f6', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem',
                    animation: 'pulse-ring 2s infinite',
                  }}>
                    📥
                  </div>
                  <div style={{ fontWeight: 700, color: '#3b82f6', fontSize: '0.9rem' }}>New Admission Request</div>
                  <button onClick={() => toast.dismiss(t.id)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
                </div>
                <div style={{ padding: '16px', display: 'flex', gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                      {data.PATIENT_NAME}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                      UHID: <span style={{ fontWeight: 600 }}>{data.UHID}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                      <span style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
                        🩺 {data.PRIMARY_DIAGNOSIS || 'No Diagnosis'}
                      </span>
                      <span style={{ fontSize: '0.7rem', padding: '2px 8px', background: data.URGENCY_LEVEL === 'Emergency' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)', color: data.URGENCY_LEVEL === 'Emergency' ? '#ef4444' : '#f59e0b', borderRadius: 6, fontWeight: 700 }}>
                        🚨 {data.URGENCY_LEVEL || 'Routine'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Requested by <strong style={{ color: 'var(--text-secondary)' }}>{data.DOCTOR_NAME}</strong>
                    </div>
                  </div>
                </div>
                <div style={{ padding: '10px 16px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => {
                    toast.dismiss(t.id);
                    window.location.href = '/ipd/requests';
                  }} style={{
                    background: '#3b82f6', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer'
                  }}>
                    View Request →
                  </button>
                </div>
              </div>
            ), { duration: 6000, position: 'top-center' });
          });
        }
      });

      setSocket(newSocket);

      return () => {
        newSocket.close();
        console.log('🔌 Disconnected from real-time server');
      };
    }
  }, [user]);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
};
