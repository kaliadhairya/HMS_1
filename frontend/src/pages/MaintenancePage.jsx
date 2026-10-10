import { useNavigate } from 'react-router-dom';
import { Wrench, RefreshCw, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// Shown when the API answers 503 during scheduled maintenance. Standalone: nothing behind it works yet.
function MaintenancePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const message = localStorage.getItem('hms_maintenance_message') || 'The system is undergoing scheduled maintenance. Please check back later.';

  // Going home triggers an API call; if maintenance is still on, the 503 handler brings the user back here.
  const handleRetry = () => navigate('/');
  const handleSignOut = () => { logout(); navigate('/login'); };

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16, background: 'var(--bg)' }}>
      <section className="panel panel-pad" style={{ maxWidth: 520, width: '100%', textAlign: 'center', padding: '36px 28px' }}>
        <span className="empty-state-icon" style={{ margin: '0 auto 14px' }}><Wrench size={22} aria-hidden="true" /></span>
        <h1 style={{ fontSize: '1.4rem', marginBottom: 8 }}>System maintenance</h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 18 }}>{message}</p>
        <div className="alert-strip alert-info" style={{ justifyContent: 'center', marginBottom: 22 }}>
          Super admins can still sign in to manage the system.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-md" onClick={handleRetry}>
            <RefreshCw size={16} aria-hidden="true" /> Try again
          </button>
          {user && (
            <button type="button" className="btn btn-ghost btn-md" onClick={handleSignOut}>
              <LogOut size={16} aria-hidden="true" /> Sign out
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

export default MaintenancePage;
