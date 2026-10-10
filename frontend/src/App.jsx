import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { ThemeProvider } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import HMSProtectedRoute from './components/HMSProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import LoginPage from './pages/LoginPage';
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'));
const RegisterPatientPage = lazy(() => import('./pages/RegisterPatientPage'));
const ReportPage = lazy(() => import('./pages/ReportPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));

// HMS Pages
const RoleDashboard = lazy(() => import('./pages/hms/RoleDashboard'));
const ChangePasswordPage = lazy(() => import('./pages/hms/ChangePasswordPage'));
const ForgotPasswordPage = lazy(() => import('./pages/hms/ForgotPasswordPage'));
const UserManagementPage = lazy(() => import('./pages/hms/UserManagementPage'));
const PermissionMatrixPage = lazy(() => import('./pages/hms/PermissionMatrixPage'));
const SecurityPage = lazy(() => import('./pages/hms/SecurityPage'));
const MaintenancePage = lazy(() => import('./pages/MaintenancePage'));

// Sprint 2 Pages
const NewPatientPage = lazy(() => import('./pages/hms/patients/NewPatientPage'));
const PatientSearchPage = lazy(() => import('./pages/hms/patients/PatientSearchPage'));
const PatientProfilePage = lazy(() => import('./pages/hms/patients/PatientProfilePage'));
const OPDTokenPage = lazy(() => import('./pages/hms/opd/OPDTokenPage'));
const AppointmentBookingPage = lazy(() => import('./pages/hms/opd/AppointmentBookingPage'));
const AppointmentListPage = lazy(() => import('./pages/hms/opd/AppointmentListPage'));
const VitalsEntryPage = lazy(() => import('./pages/hms/opd/VitalsEntryPage'));

// Sprint 3 Pages
const ConsultationPage = lazy(() => import('./pages/hms/consultation/ConsultationPage'));
const PrescriptionSlipPage = lazy(() => import('./pages/hms/consultation/PrescriptionSlipPage'));

const PrescriptionPreviewPage = lazy(() => import('./pages/hms/pharmacy/PrescriptionPreviewPage'));
const InvestigationQueuePage = lazy(() => import('./pages/hms/lab/InvestigationQueuePage'));
const RestFormHubPage = lazy(() => import('./pages/hms/doctor/RestFormHubPage'));
const RestFormEditorPage = lazy(() => import('./pages/hms/doctor/RestFormEditorPage'));
const RestFormPrintPage = lazy(() => import('./pages/hms/doctor/RestFormPrintPage'));

// Sprint 4 — Pharmacy Pages
const MedicineMasterPage = lazy(() => import('./pages/hms/pharmacy/MedicineMasterPage'));
const PharmacyStockPage = lazy(() => import('./pages/hms/pharmacy/PharmacyStockPage'));
const GRNPage = lazy(() => import('./pages/hms/pharmacy/GRNPage'));
const DispensePage = lazy(() => import('./pages/hms/pharmacy/DispensePage'));
const OTCSalePage = lazy(() => import('./pages/hms/pharmacy/OTCSalePage'));
const ExpiryAlertsPage = lazy(() => import('./pages/hms/pharmacy/ExpiryAlertsPage'));
const SupplierMasterPage = lazy(() => import('./pages/hms/pharmacy/SupplierMasterPage'));
const PurchaseOrdersPage = lazy(() => import('./pages/hms/pharmacy/PurchaseOrdersPage'));
const RaiseIndentPage = lazy(() => import('./pages/hms/pharmacy/RaiseIndentPage'));
const PharmacyReturnsPage = lazy(() => import('./pages/hms/pharmacy/PharmacyReturnsPage'));
const PharmacyReportsPage = lazy(() => import('./pages/hms/pharmacy/PharmacyReportsPage'));

// Part B - IPD & Billing Pages
const BedManagementPage = lazy(() => import('./pages/hms/ipd/BedManagementPage'));
const IPDPatientListPage = lazy(() => import('./pages/hms/ipd/IPDPatientListPage'));
const IPDDischargeSummariesPage = lazy(() => import('./pages/hms/ipd/IPDDischargeSummariesPage'));
const IPDPatientChartPage = lazy(() => import('./pages/hms/ipd/IPDPatientChartPage'));
const IPDRequestsPage = lazy(() => import('./pages/hms/ipd/IPDRequestsPage'));
const IPDAdmissionFormPage = lazy(() => import('./pages/hms/ipd/IPDAdmissionFormPage'));
const IPDBillingListPage = lazy(() => import('./pages/hms/ipd/IPDBillingListPage'));
const IPDBillingPage = lazy(() => import('./pages/hms/ipd/IPDBillingPage'));
const IPDSavedBillsPage = lazy(() => import('./pages/hms/ipd/IPDSavedBillsPage'));
const OPDBillingPage = lazy(() => import('./pages/hms/billing/OPDBillingPage'));
const BillingHistoryPage = lazy(() => import('./pages/hms/billing/BillingHistoryPage'));

// Part C - Reports & Admin Settings Pages
const AdminSettingsPage = lazy(() => import('./pages/AdminSettingsPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));

// Part D - Patient Journey
const PatientJourneyPage = lazy(() => import('./pages/PatientJourneyPage'));

// Admin-Ops Pages
const StaffManagementPage = lazy(() => import('./pages/hms/StaffManagementPage'));
const AdminPatientsPage = lazy(() => import('./pages/hms/admin/AdminPatientsPage'));
const AdminBillingPage = lazy(() => import('./pages/hms/admin/AdminBillingPage'));
const AdminPharmacyPage = lazy(() => import('./pages/hms/admin/AdminPharmacyPage'));
const AttendanceLeavePage = lazy(() => import('./pages/hms/admin/AttendanceLeavePage'));
const NoticesPage = lazy(() => import('./pages/hms/admin/NoticesPage'));
const AdminBedManagementPage = lazy(() => import('./pages/hms/admin/AdminBedManagementPage'));

// Doctor Module Pages
const DoctorPrescriptionsPage = lazy(() => import('./pages/hms/doctor/DoctorPrescriptionsPage.jsx'));
const DoctorLabsPage = lazy(() => import('./pages/hms/doctor/DoctorLabsPage.jsx'));
const DoctorSchedulePage = lazy(() => import('./pages/hms/doctor/DoctorSchedulePage.jsx'));
const DoctorReportsPage = lazy(() => import('./pages/hms/doctor/DoctorReportsPage.jsx'));
const DoctorReferralsPage = lazy(() => import('./pages/hms/doctor/DoctorReferralsPage.jsx'));
const DoctorClinicalNotesPage = lazy(() => import('./pages/hms/doctor/DoctorClinicalNotesPage.jsx'));
const DoctorQuickConsultPage = lazy(() => import('./pages/hms/doctor/DoctorQuickConsultPage.jsx'));

// Receptionist Module Pages
const ReceptionistAppointmentsPage = lazy(() => import('./pages/hms/receptionist/ReceptionistAppointmentsPage.jsx'));
const ReceptionistBillingPage = lazy(() => import('./pages/hms/receptionist/ReceptionistBillingPage.jsx'));
const ReceptionistIPDPage = lazy(() => import('./pages/hms/receptionist/ReceptionistIPDPage.jsx'));
const VisitorManagementPage = lazy(() => import('./pages/hms/receptionist/VisitorManagementPage.jsx'));
const ReceptionistNotificationsPage = lazy(() => import('./pages/hms/receptionist/ReceptionistNotificationsPage.jsx'));

// Lab Technician LIMS Pages
const LabTestQueuePage = lazy(() => import('./pages/hms/lab/LabTestQueuePage.jsx'));
const LabSampleCollectionPage = lazy(() => import('./pages/hms/lab/LabSampleCollectionPage.jsx'));
const LabResultsEntryPage = lazy(() => import('./pages/hms/lab/LabResultsEntryPage.jsx'));
const LabReportsPage = lazy(() => import('./pages/hms/lab/LabReportsPage.jsx'));
const LabWorkloadPage = lazy(() => import('./pages/hms/lab/LabWorkloadPage.jsx'));

function PageLoader() {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function DashboardRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const role = user.role;
  if (role === 'doctor') return <Navigate to="/doctor/dashboard" replace />;
  if (role === 'super_admin') return <Navigate to="/super_admin/dashboard" replace />;
  if (role === 'admin') return <Navigate to="/admin/dashboard" replace />;
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
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
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
            <Route path="/doctor/medical-certificate" element={<HMSProtectedRoute allowedRoles={['super_admin', 'admin', 'doctor']}><RestFormEditorPage /></HMSProtectedRoute>} />
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
              <HMSProtectedRoute allowedRoles={['doctor']}>
                <DoctorPrescriptionsPage />
              </HMSProtectedRoute>
            } />
            <Route path="/doctor/labs" element={
              <HMSProtectedRoute allowedRoles={['doctor']}>
                <DoctorLabsPage />
              </HMSProtectedRoute>
            } />
            <Route path="/doctor/schedule" element={
              <HMSProtectedRoute allowedRoles={['doctor']}>
                <DoctorSchedulePage />
              </HMSProtectedRoute>
            } />
            <Route path="/doctor/reports" element={
              <HMSProtectedRoute allowedRoles={['doctor']}>
                <DoctorReportsPage />
              </HMSProtectedRoute>
            } />
            <Route path="/doctor/referrals" element={
              <HMSProtectedRoute allowedRoles={['doctor']}>
                <DoctorReferralsPage />
              </HMSProtectedRoute>
            } />
            <Route path="/doctor/clinical-notes" element={
              <HMSProtectedRoute allowedRoles={['doctor']}>
                <DoctorClinicalNotesPage />
              </HMSProtectedRoute>
            } />
            <Route path="/doctor/quick-consult" element={
              <HMSProtectedRoute allowedRoles={['doctor']}>
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
            </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
        </SocketProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
