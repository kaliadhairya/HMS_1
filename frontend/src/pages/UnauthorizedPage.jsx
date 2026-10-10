import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowLeft, LayoutDashboard } from 'lucide-react';
import Navbar from '../components/Navbar';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../context/AuthContext';

// Shown when a signed-in user opens a page their role cannot use.
export default function UnauthorizedPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    return (
      <main className="app-page" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <h1 className="sr-only">Sign in required</h1>
        <EmptyState
          icon={ShieldAlert}
          title="Sign in to continue"
          description="Your session has ended or you are not signed in."
          action={<button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/login')}>Sign in</button>}
        />
      </main>
    );
  }

  return (
    <>
      <Navbar />
      <main className="app-page">
        <h1 className="sr-only">Access denied</h1>
        <section className="panel">
          <EmptyState
            icon={ShieldAlert}
            title="You don't have access to this page"
            description="Your role doesn't include this area. If you need it for your work, ask an administrator to change your access."
            action={(
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate(-1)}><ArrowLeft size={16} aria-hidden="true" /> Go back</button>
                <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/dashboard')}><LayoutDashboard size={16} aria-hidden="true" /> Go to dashboard</button>
              </div>
            )}
          />
        </section>
      </main>
    </>
  );
}
