import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Navbar from '../../components/Navbar';
import SuperAdminDashboard from '../../components/dashboards/SuperAdminDashboard';
import AdminDashboard from '../../components/dashboards/AdminDashboard';
import DoctorDashboard from '../../components/dashboards/DoctorDashboard';
import ReceptionistDashboard from '../../components/dashboards/ReceptionistDashboard';
import PharmacistDashboard from '../../components/dashboards/PharmacistDashboard';
import NurseDashboard from '../../components/dashboards/NurseDashboard';

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
      <div 
        className="page-wrapper" 
        style={['doctor', 'nurse', 'pharmacist'].includes(role) ? { maxWidth: '100%', padding: '0', overflow: 'hidden' } : {}}
      >
        {dashboardMap[role] || (
          <div className="card" style={{ padding: 40, textAlign: 'center' }}>
            <h2>🏥 Welcome to HMS</h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
              Your dashboard is being configured. Please contact the administrator.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
