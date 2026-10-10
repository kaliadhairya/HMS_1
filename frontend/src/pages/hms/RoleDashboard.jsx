import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Navbar from '../../components/Navbar';
import SuperAdminDashboard from '../../components/dashboards/SuperAdminDashboard';
import AdminDashboard from '../../components/dashboards/AdminDashboard';
import DoctorDashboard from '../../components/dashboards/DoctorDashboard';
import ReceptionistDashboard from '../../components/dashboards/ReceptionistDashboard';
import PharmacistDashboard from '../../components/dashboards/PharmacistDashboard';
import NurseDashboard from '../../components/dashboards/NurseDashboard';
import { Hospital } from 'lucide-react';

export default function RoleDashboard() {
  const { user } = useAuth();
  const role = user?.role;

  if (role === 'lab_technician') return <Navigate to="/dashboard" replace />;

  const dashboardMap = {
    super_admin: <SuperAdminDashboard />,
    admin: <AdminDashboard />,
    doctor: <DoctorDashboard />,
    receptionist: <ReceptionistDashboard />,
    pharmacist: <PharmacistDashboard />,
    nurse: <NurseDashboard />,
  };

  return (
    <>
      <Navbar />
      <main className="app-page">
        {dashboardMap[role] || (
          <div className="card" style={{ padding: 40, textAlign: 'center' }}>
            <h1 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Hospital size={22} aria-hidden="true" /> Welcome to HMS</h1>
            <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
              Your dashboard is being configured. Please contact the administrator.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
