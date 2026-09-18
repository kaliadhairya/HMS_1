import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { ThemeProvider } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import HMSProtectedRoute from './components/HMSProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import RegisterPatientPage from './pages/RegisterPatientPage';
import ReportPage from './pages/ReportPage';
import SearchPage from './pages/SearchPage';

// HMS Pages
import RoleDashboard from './pages/hms/RoleDashboard';
import ChangePasswordPage from './pages/hms/ChangePasswordPage';
import ForgotPasswordPage from './pages/hms/ForgotPasswordPage';
import UserManagementPage from './pages/hms/UserManagementPage';
import PermissionMatrixPage from './pages/hms/PermissionMatrixPage';
import SecurityPage from './pages/hms/SecurityPage';
import MaintenancePage from './pages/MaintenancePage';

// Sprint 2 Pages
import NewPatientPage from './pages/hms/patients/NewPatientPage';
import PatientSearchPage from './pages/hms/patients/PatientSearchPage';
import PatientProfilePage from './pages/hms/patients/PatientProfilePage';
import OPDTokenPage from './pages/hms/opd/OPDTokenPage';
import AppointmentBookingPage from './pages/hms/opd/AppointmentBookingPage';
import AppointmentListPage from './pages/hms/opd/AppointmentListPage';
import VitalsEntryPage from './pages/hms/opd/VitalsEntryPage';

// Sprint 3 Pages
import ConsultationPage from './pages/hms/consultation/ConsultationPage';
import PrescriptionSlipPage from './pages/hms/consultation/PrescriptionSlipPage';

import PrescriptionPreviewPage from './pages/hms/pharmacy/PrescriptionPreviewPage';
import InvestigationQueuePage from './pages/hms/lab/InvestigationQueuePage';
import RestFormHubPage from './pages/hms/doctor/RestFormHubPage';
import RestFormEditorPage from './pages/hms/doctor/RestFormEditorPage';
import RestFormPrintPage from './pages/hms/doctor/RestFormPrintPage';

// Sprint 4 — Pharmacy Pages
import MedicineMasterPage from './pages/hms/pharmacy/MedicineMasterPage';
import PharmacyStockPage from './pages/hms/pharmacy/PharmacyStockPage';
import GRNPage from './pages/hms/pharmacy/GRNPage';
import DispensePage from './pages/hms/pharmacy/DispensePage';
import OTCSalePage from './pages/hms/pharmacy/OTCSalePage';
import ExpiryAlertsPage from './pages/hms/pharmacy/ExpiryAlertsPage';
import SupplierMasterPage from './pages/hms/pharmacy/SupplierMasterPage';
import PurchaseOrdersPage from './pages/hms/pharmacy/PurchaseOrdersPage';
import RaiseIndentPage from './pages/hms/pharmacy/RaiseIndentPage';
import PharmacyReturnsPage from './pages/hms/pharmacy/PharmacyReturnsPage';
import PharmacyReportsPage from './pages/hms/pharmacy/PharmacyReportsPage';

// Part B - IPD & Billing Pages
import BedManagementPage from './pages/hms/ipd/BedManagementPage';
import IPDPatientListPage from './pages/hms/ipd/IPDPatientListPage';
import IPDDischargeSummariesPage from './pages/hms/ipd/IPDDischargeSummariesPage';
import IPDPatientChartPage from './pages/hms/ipd/IPDPatientChartPage';
import IPDRequestsPage from './pages/hms/ipd/IPDRequestsPage';
import IPDAdmissionFormPage from './pages/hms/ipd/IPDAdmissionFormPage';
import IPDBillingListPage from './pages/hms/ipd/IPDBillingListPage';
import IPDBillingPage from './pages/hms/ipd/IPDBillingPage';
import IPDSavedBillsPage from './pages/hms/ipd/IPDSavedBillsPage';
import OPDBillingPage from './pages/hms/billing/OPDBillingPage';
import BillingHistoryPage from './pages/hms/billing/BillingHistoryPage';

// Part C - Reports & Admin Settings Pages
import AdminSettingsPage from './pages/AdminSettingsPage';
import ReportsPage from './pages/ReportsPage';

// Part D - Patient Journey
import PatientJourneyPage from './pages/PatientJourneyPage';

// Admin-Ops Pages
import StaffManagementPage from './pages/hms/StaffManagementPage';
import AdminPatientsPage from './pages/hms/admin/AdminPatientsPage';
import AdminBillingPage from './pages/hms/admin/AdminBillingPage';
import AdminPharmacyPage from './pages/hms/admin/AdminPharmacyPage';
import AttendanceLeavePage from './pages/hms/admin/AttendanceLeavePage';
import NoticesPage from './pages/hms/admin/NoticesPage';
import AdminBedManagementPage from './pages/hms/admin/AdminBedManagementPage';

// Doctor Module Pages
import DoctorPrescriptionsPage from './pages/hms/doctor/DoctorPrescriptionsPage.jsx';
import DoctorLabsPage from './pages/hms/doctor/DoctorLabsPage.jsx';
import DoctorSchedulePage from './pages/hms/doctor/DoctorSchedulePage.jsx';
import DoctorReportsPage from './pages/hms/doctor/DoctorReportsPage.jsx';
import DoctorReferralsPage from './pages/hms/doctor/DoctorReferralsPage.jsx';
import DoctorClinicalNotesPage from './pages/hms/doctor/DoctorClinicalNotesPage.jsx';
import DoctorQuickConsultPage from './pages/hms/doctor/DoctorQuickConsultPage.jsx';

// Receptionist Module Pages
import ReceptionistAppointmentsPage from './pages/hms/receptionist/ReceptionistAppointmentsPage.jsx';
import ReceptionistBillingPage from './pages/hms/receptionist/ReceptionistBillingPage.jsx';
import ReceptionistIPDPage from './pages/hms/receptionist/ReceptionistIPDPage.jsx';
import VisitorManagementPage from './pages/hms/receptionist/VisitorManagementPage.jsx';
import ReceptionistNotificationsPage from './pages/hms/receptionist/ReceptionistNotificationsPage.jsx';

// Lab Technician LIMS Pages
import LabTestQueuePage from './pages/hms/lab/LabTestQueuePage.jsx';
import LabSampleCollectionPage from './pages/hms/lab/LabSampleCollectionPage.jsx';
import LabResultsEntryPage from './pages/hms/lab/LabResultsEntryPage.jsx';
import LabReportsPage from './pages/hms/lab/LabReportsPage.jsx';
import LabWorkloadPage from './pages/hms/lab/LabWorkloadPage.jsx';

function DashboardRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const role = user.role;
  if (role === 'doctor') return <Navigate to="/doctor/dashboard" replace />;
  if (role === 'admin' || role === 'super_admin') return <Navigate to="/admin/dashboard" replace />;
  if (role === 'receptionist') return <Navigate to="/receptionist/dashboard" replace />;
  if (role === 'pharmacist') return <Navigate to="/pharmacist/dashboard" replace />;
  if (role === 'nurse') return <Navigate to="/nurse/dashboard" replace />;
  if (role === 'lab_technician') return <DashboardPage />;
  return <Navigate to={`/${role}/dashboard`} replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SocketProvider>
        <BrowserRouter>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: 'var(--surface-3)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                fontFamily: 'var(--font-body)',
                fontSize: '0.875rem',
              },
              success: { iconTheme: { primary: 'var(--green)', secondary: '#fff' } },
              error: { iconTheme: { primary: 'var(--red)', secondary: '#fff' } },
            }}
          />
          <Routes>
            {/* Existing routes — fully preserved */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/maintenance" element={<MaintenancePage />} />
            <Route path="/dashboard" element={<ProtectedRoute><DashboardRedirect /></ProtectedRoute>} />
            <Route path="/register/:type" element={<ProtectedRoute><RegisterPatientPage /></ProtectedRoute>} />
            <Route path="/edit/:id" element={<ProtectedRoute><RegisterPatientPage /></ProtectedRoute>} />
            <Route path="/search" element={<ProtectedRoute><SearchPage /></ProtectedRoute>} />
            <Route path="/report/:reportId" element={<ProtectedRoute><ReportPage /></ProtectedRoute>} />

            {/* Lab Technician LIMS Routes */}
            <Route path="/lab/queue" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'lab_technician']}><LabTestQueuePage /></HMSProtectedRoute>} />
            <Route path="/lab/samples" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'lab_technician']}><LabSampleCollectionPage /></HMSProtectedRoute>} />
            <Route path="/lab/results" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'lab_technician']}><LabResultsEntryPage /></HMSProtectedRoute>} />
            <Route path="/lab/reports" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'lab_technician']}><LabReportsPage /></HMSProtectedRoute>} />
            <Route path="/lab/workload" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'lab_technician']}><LabWorkloadPage /></HMSProtectedRoute>} />
            <Route path="/ipd/patients" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor', 'nurse', 'receptionist']}><IPDPatientListPage /></HMSProtectedRoute>} />
            <Route path="/ipd/discharge-summaries" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor', 'nurse', 'receptionist']}><IPDDischargeSummariesPage /></HMSProtectedRoute>} />
            <Route path="/ipd/requests" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor', 'nurse', 'receptionist']}><IPDRequestsPage /></HMSProtectedRoute>} />
            <Route path="/ipd/admission-form" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}><IPDAdmissionFormPage /></HMSProtectedRoute>} />
            <Route path="/ipd/patient/:id" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor', 'nurse']}><IPDPatientChartPage /></HMSProtectedRoute>} />
            <Route path="/ipd/billing" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'nurse']}><IPDBillingListPage /></HMSProtectedRoute>} />
            <Route path="/ipd/billing/:admissionId" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'nurse']}><IPDBillingPage /></HMSProtectedRoute>} />
            <Route path="/ipd/saved-bills" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'nurse']}><IPDSavedBillsPage /></HMSProtectedRoute>} />

            {/* HMS role-based dashboards — must be before /admin/dashboard */}
            <Route path="/doctor/rest-forms" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}><RestFormHubPage /></HMSProtectedRoute>} />
            <Route path="/doctor/rest-forms/new" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}><RestFormEditorPage /></HMSProtectedRoute>} />
            <Route path="/doctor/rest-forms/edit/:id" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}><RestFormEditorPage /></HMSProtectedRoute>} />
            <Route path="/doctor/rest-forms/print/:id" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}><RestFormPrintPage /></HMSProtectedRoute>} />
            <Route path="/:role/dashboard" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor', 'lab_technician', 'receptionist', 'pharmacist', 'nurse']}>
                <RoleDashboard />
              </HMSProtectedRoute>
            } />
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="/hms/change-password" element={
              <ProtectedRoute><ChangePasswordPage /></ProtectedRoute>
            } />
            <Route path="/hms/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/hms/admin/users" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin']}>
                <UserManagementPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/admin/permissions" element={
              <HMSProtectedRoute allowedRoles={['super_admin']}>
                <PermissionMatrixPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/admin/security" element={
              <HMSProtectedRoute allowedRoles={['super_admin']}>
                <SecurityPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/admin/bed-management" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin']}>
                <AdminBedManagementPage />
              </HMSProtectedRoute>
            } />

            {/* Sprint 2 Routes */}
            <Route path="/hms/patients/new" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'receptionist', 'doctor']}>
                <NewPatientPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/patients/search" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor', 'receptionist', 'nurse']}>
                <PatientSearchPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/patients/:id" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor', 'receptionist', 'nurse']}>
                <PatientProfilePage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/opd/token" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'receptionist']}>
                <OPDTokenPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/appointments/book" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'receptionist', 'doctor']}>
                <AppointmentBookingPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/appointments" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'receptionist', 'doctor']}>
                <AppointmentListPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/vitals/entry" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'nurse', 'doctor']}>
                <VitalsEntryPage />
              </HMSProtectedRoute>
            } />

            {/* Sprint 3 Routes */}
            <Route path="/hms/consultation/:id" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'doctor']}>
                <ConsultationPage />
              </HMSProtectedRoute>
            } />

            {/* Doctor Workflow Routes */}
            <Route path="/doctor/prescriptions" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}>
                <DoctorPrescriptionsPage />
              </HMSProtectedRoute>
            } />
            <Route path="/doctor/labs" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}>
                <DoctorLabsPage />
              </HMSProtectedRoute>
            } />
            <Route path="/doctor/schedule" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}>
                <DoctorSchedulePage />
              </HMSProtectedRoute>
            } />
            <Route path="/doctor/reports" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}>
                <DoctorReportsPage />
              </HMSProtectedRoute>
            } />
            <Route path="/doctor/referrals" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}>
                <DoctorReferralsPage />
              </HMSProtectedRoute>
            } />
            <Route path="/doctor/clinical-notes" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}>
                <DoctorClinicalNotesPage />
              </HMSProtectedRoute>
            } />
            <Route path="/doctor/quick-consult" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}>
                <DoctorQuickConsultPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/prescription-slip" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'doctor']}>
                <PrescriptionSlipPage />
              </HMSProtectedRoute>
            } />
            <Route path="/prescription/:id/print" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'doctor', 'pharmacist']}>
                <PrescriptionPreviewPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/lab/queue" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'lab_technician']}>
                <InvestigationQueuePage />
              </HMSProtectedRoute>
            } />

            {/* Sprint 4 — Pharmacy Routes */}
            <Route path="/pharmacy/medicines" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'pharmacist']}>
                <MedicineMasterPage />
              </HMSProtectedRoute>
            } />
            <Route path="/pharmacy/suppliers" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'pharmacist']}>
                <SupplierMasterPage />
              </HMSProtectedRoute>
            } />
                        <Route path="/pharmacy/pos" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'pharmacist']}>
                <PurchaseOrdersPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/pharmacy/raise-indent" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'pharmacist']}>
                <RaiseIndentPage />
              </HMSProtectedRoute>
            } />
            <Route path="/pharmacy/returns" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'pharmacist']}>
                <PharmacyReturnsPage />
              </HMSProtectedRoute>
            } />
            <Route path="/pharmacy/reports" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'pharmacist']}>
                <PharmacyReportsPage />
              </HMSProtectedRoute>
            } />
            <Route path="/pharmacy/stock" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'pharmacist']}>
                <PharmacyStockPage />
              </HMSProtectedRoute>
            } />
            <Route path="/pharmacy/grn" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'pharmacist']}>
                <GRNPage />
              </HMSProtectedRoute>
            } />
            <Route path="/pharmacy/dispense" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'pharmacist']}>
                <DispensePage />
              </HMSProtectedRoute>
            } />
            <Route path="/pharmacy/otc" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'pharmacist']}>
                <OTCSalePage />
              </HMSProtectedRoute>
            } />
            <Route path="/pharmacy/expiry" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'pharmacist']}>
                <ExpiryAlertsPage />
              </HMSProtectedRoute>
            } />

            {/* Part B — IPD Routes */}
            <Route path="/ipd/beds" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'nurse', 'doctor', 'receptionist']}>
                <BedManagementPage />
              </HMSProtectedRoute>
            } />
            <Route path="/ipd/patients" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'nurse', 'doctor', 'receptionist']}>
                <IPDPatientListPage />
              </HMSProtectedRoute>
            } />
            <Route path="/ipd/patient/:id" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'nurse', 'doctor']}>
                <IPDPatientChartPage />
              </HMSProtectedRoute>
            } />

            {/* Receptionist Workflow Routes */}
            <Route path="/receptionist/appointments" element={
              <HMSProtectedRoute allowedRoles={['receptionist']}>
                <ReceptionistAppointmentsPage />
              </HMSProtectedRoute>
            } />
            <Route path="/receptionist/billing" element={
              <HMSProtectedRoute allowedRoles={['receptionist']}>
                <ReceptionistBillingPage />
              </HMSProtectedRoute>
            } />
            <Route path="/receptionist/ipd" element={
              <HMSProtectedRoute allowedRoles={['receptionist']}>
                <ReceptionistIPDPage />
              </HMSProtectedRoute>
            } />
            <Route path="/receptionist/visitors" element={
              <HMSProtectedRoute allowedRoles={['receptionist']}>
                <VisitorManagementPage />
              </HMSProtectedRoute>
            } />
            <Route path="/receptionist/notifications" element={
              <HMSProtectedRoute allowedRoles={['receptionist']}>
                <ReceptionistNotificationsPage />
              </HMSProtectedRoute>
            } />

            {/* Part B — Billing Routes */}
            <Route path="/billing/opd/:encounterId" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'receptionist']}>
                <OPDBillingPage />
              </HMSProtectedRoute>
            } />
            <Route path="/billing/patient/:patientId" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'receptionist', 'doctor']}>
                <BillingHistoryPage />
              </HMSProtectedRoute>
            } />

            {/* Part C — Admin Settings & Reports Routes */}
            <Route path="/admin/settings" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin']}>
                <AdminSettingsPage />
              </HMSProtectedRoute>
            } />
            <Route path="/reports" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}>
                <ReportsPage />
              </HMSProtectedRoute>
            } />

            {/* Part D — Patient Journey */}
            <Route path="/patient/:patientId/journey" element={
              <HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor', 'receptionist', 'nurse']}>
                <PatientJourneyPage />
              </HMSProtectedRoute>
            } />

            {/* Admin-Ops Routes */}
            <Route path="/hms/admin/staff" element={
              <HMSProtectedRoute allowedRoles={['admin']}>
                <StaffManagementPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/admin/patients" element={
              <HMSProtectedRoute allowedRoles={['admin']}>
                <AdminPatientsPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/admin/billing" element={
              <HMSProtectedRoute allowedRoles={['admin']}>
                <AdminBillingPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/admin/pharmacy" element={
              <HMSProtectedRoute allowedRoles={['admin']}>
                <AdminPharmacyPage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/admin/attendance" element={
              <HMSProtectedRoute allowedRoles={['admin']}>
                <AttendanceLeavePage />
              </HMSProtectedRoute>
            } />
            <Route path="/hms/admin/notices" element={
              <HMSProtectedRoute allowedRoles={['admin']}>
                <NoticesPage />
              </HMSProtectedRoute>
            } />

            {/* Unauthorized */}
            <Route path="/unauthorized" element={
              <div style={{
                minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg)', flexDirection: 'column', gap: 16,
              }}>
                <div style={{ fontSize: '3rem' }}>🚫</div>
                <h2>Access Denied</h2>
                <p style={{ color: 'var(--text-secondary)' }}>You don't have permission to view this page.</p>
                <a href="/login" className="btn btn-primary">← Back to Login</a>
              </div>
            } />

            {/* Default redirects */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
        </SocketProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
