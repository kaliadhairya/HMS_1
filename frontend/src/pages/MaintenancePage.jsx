import React from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';

function MaintenancePage() {
  const navigate = useNavigate();
  const message = localStorage.getItem('hms_maintenance_message') || 'The system is currently undergoing scheduled maintenance. Please check back later.';

  const handleRetry = () => {
    // Navigate back to home/dashboard, which will trigger an API call. 
    // If still in maintenance, the 503 interceptor will bounce them back here.
    navigate('/');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--background)' }}>
      <Navbar />
      
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ 
          maxWidth: 600, 
          width: '100%',
          backgroundColor: 'var(--surface)', 
          borderRadius: 16, 
          boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
          overflow: 'hidden',
          textAlign: 'center',
          animation: 'fadeUp 0.6s ease-out'
        }}>
          {/* Header Banner */}
          <div style={{ 
            backgroundColor: '#ef4444', 
            color: '#fff', 
            padding: '30px 20px',
          }}>
            <div style={{ fontSize: '4rem', marginBottom: 10 }}>🔨</div>
            <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 800 }}>System Maintenance</h1>
          </div>

          {/* Content */}
          <div style={{ padding: '40px 30px' }}>
            <p style={{ 
              fontSize: '1.1rem', 
              color: 'var(--text-secondary)', 
              lineHeight: 1.6,
              marginBottom: 30,
              fontWeight: 500
            }}>
              {message}
            </p>

            <div style={{ 
              backgroundColor: 'rgba(239,68,68,0.08)', 
              border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 8,
              padding: '16px 20px',
              display: 'inline-block',
              marginBottom: 30
            }}>
              <span style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 600 }}>
                ⚠️ Super Admins can still log in to manage the system.
              </span>
            </div>

            <br />
            
            <button 
              onClick={handleRetry}
              className="btn btn-primary"
              style={{ padding: '12px 30px', fontSize: '1rem', borderRadius: 8 }}
            >
              🔄 Try Again
            </button>
            <div style={{ marginTop: 16 }}>
              <button 
                onClick={() => {
                  localStorage.removeItem('lab_token');
                  localStorage.removeItem('lab_user');
                  navigate('/login');
                }}
                className="btn btn-ghost"
                style={{ color: 'var(--text-muted)' }}
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MaintenancePage;
