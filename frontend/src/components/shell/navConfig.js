import {
  LayoutDashboard, Search, UserPlus, Pill, Users, BedDouble, Inbox, ChartColumn, CalendarDays, Hospital,
  Settings, Droplet, TestTube, ShoppingCart, Bell, ShieldCheck, Repeat, Package, ClipboardList, ChartLine,
  FileText, CreditCard, Wallet, Factory, Ticket, HeartPulse, Clock, Undo2, ListOrdered, BookOpen, ListChecks, BadgeCheck, FileInput, Cable, CloudOff, FilePlus2, Truck, Megaphone, Stethoscope,
} from 'lucide-react';

// Navigation per role. `group` drives the sidebar sections.
const LAB = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
  { to: '/lab/governed', label: 'Laboratory workspace', icon: TestTube, group: 'Laboratory' },
  { to: '/lab/queue', label: 'Test queue', icon: TestTube, group: 'Laboratory' },
  { to: '/lab/samples', label: 'Samples', icon: Droplet, group: 'Laboratory' },
  { to: '/lab/results', label: 'Results entry', icon: ClipboardList, group: 'Laboratory' },
  { to: '/lab/reports', label: 'Reports', icon: FileText, group: 'Laboratory' },
  { to: '/lab/workload', label: 'Workload', icon: ChartLine, group: 'Laboratory' },
  { to: '/worklist', label: 'Worklist', icon: ListChecks, group: 'Laboratory' },
  { to: '/downtime', label: 'Downtime', icon: CloudOff, group: 'Laboratory' },
  { to: '/admin/devices', label: 'Device interfaces', icon: Cable, group: 'Laboratory' },
  { to: '/search', label: 'Search', icon: Search, group: 'Patients' },
];

export const NAV_BY_ROLE = {
  super_admin: [
    { to: '/admin/interface-messages', label: 'Interface deliveries', icon: Cable, group: 'Administration' },
    { to: '/hms/admin/clinical-privileges', label: 'Clinical privileges', icon: ShieldCheck, group: 'Administration' },
    { to: '/lab/governed', label: 'Laboratory workspace', icon: TestTube, group: 'Laboratory' },
    { to: '/super_admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
    { to: '/hms/patients/search', label: 'Patients', icon: Search, group: 'Patients' },
    { to: '/hms/patients/duplicates', label: 'Possible duplicates', icon: Users, group: 'Patients' },
    { to: '/hms/triage', label: 'Emergency triage', icon: HeartPulse, group: 'Patients' },
    { to: '/hms/adt', label: 'Beds and discharge', icon: BedDouble, group: 'Inpatient' },
    { to: '/hms/practitioners', label: 'Practitioners', icon: Stethoscope, group: 'Patients' },
    { to: '/abdm/outside-records', label: 'Outside records', icon: FileInput, group: 'Patients' },
    { to: '/abdm', label: 'ABDM', icon: BadgeCheck, group: 'Patients' },
    { to: '/pharmacy/medicines', label: 'Medicines', icon: Pill, group: 'Pharmacy' },
    { to: '/reports', label: 'Reports', icon: ChartColumn, group: 'Insights' },
    { to: '/hms/admin/users', label: 'Users', icon: Users, group: 'Administration' },
    { to: '/hms/admin/security', label: 'Security', icon: ShieldCheck, group: 'Administration' },
    { to: '/billing/desk', label: 'Billing desk', icon: Wallet, group: 'Finance' },
    { to: '/billing/reconciliation', label: 'Reconciliation', icon: ShieldCheck, group: 'Finance' },
    { to: '/billing/price-list', label: 'Price list', icon: ListOrdered, group: 'Finance' },
    { to: '/admin/settings', label: 'Settings', icon: Settings, group: 'Administration' },
    { to: '/admin/terminology', label: 'Terminology', icon: BookOpen, group: 'Administration' },
    { to: '/worklist', label: 'Worklist', icon: ListChecks, group: 'Administration' },
    { to: '/downtime', label: 'Downtime', icon: CloudOff, group: 'Administration' },
    { to: '/admin/devices', label: 'Device interfaces', icon: Cable, group: 'Administration' },
  ],
  admin: [
    { to: '/admin/interface-messages', label: 'Interface deliveries', icon: Cable, group: 'Administration' },
    { to: '/hms/admin/clinical-privileges', label: 'Clinical privileges', icon: ShieldCheck, group: 'Administration' },
    { to: '/lab/governed', label: 'Laboratory workspace', icon: TestTube, group: 'Laboratory' },
    { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
    { to: '/hms/admin/patients', label: 'Patients', icon: Hospital, group: 'Patients' },
    { to: '/hms/patients/duplicates', label: 'Possible duplicates', icon: Users, group: 'Patients' },
    { to: '/hms/triage', label: 'Emergency triage', icon: HeartPulse, group: 'Patients' },
    { to: '/hms/referrals', label: 'Referrals', icon: Repeat, group: 'Patients' },
    { to: '/hms/adt', label: 'Beds and discharge', icon: BedDouble, group: 'Inpatient' },
    { to: '/hms/practitioners', label: 'Practitioners', icon: Stethoscope, group: 'Patients' },
    { to: '/hms/appointments', label: 'Appointments', icon: CalendarDays, group: 'Patients' },
    { to: '/abdm/outside-records', label: 'Outside records', icon: FileInput, group: 'Patients' },
    { to: '/abdm', label: 'ABDM', icon: BadgeCheck, group: 'Patients' },
    { to: '/hms/admin/bed-management', label: 'Bed management', icon: BedDouble, group: 'Inpatient' },
    { to: '/hms/admin/pharmacy', label: 'Pharmacy', icon: Package, group: 'Pharmacy' },
    { to: '/pharmacy/medicines', label: 'Medicines', icon: Pill, group: 'Pharmacy' },
    { to: '/hms/admin/billing', label: 'Billing', icon: CreditCard, group: 'Finance' },
    { to: '/billing/desk', label: 'Billing desk', icon: Wallet, group: 'Finance' },
    { to: '/billing/reconciliation', label: 'Reconciliation', icon: ShieldCheck, group: 'Finance' },
    { to: '/billing/price-list', label: 'Price list', icon: ListOrdered, group: 'Finance' },
    { to: '/ipd/billing', label: 'IPD billing', icon: BedDouble, group: 'Finance' },
    { to: '/admin/terminology', label: 'Terminology', icon: BookOpen, group: 'Administration' },
    { to: '/worklist', label: 'Worklist', icon: ListChecks, group: 'Administration' },
    { to: '/downtime', label: 'Downtime', icon: CloudOff, group: 'Administration' },
    { to: '/admin/devices', label: 'Device interfaces', icon: Cable, group: 'Administration' },
    { to: '/reports', label: 'Reports', icon: ChartColumn, group: 'Insights' },
    { to: '/hms/admin/staff', label: 'Staff', icon: Users, group: 'Administration' },
    { to: '/hms/admin/attendance', label: 'Attendance & leave', icon: Clock, group: 'Administration' },
    { to: '/hms/admin/notices', label: 'Notices', icon: Megaphone, group: 'Administration' },
    { to: '/admin/settings', label: 'Settings', icon: Settings, group: 'Administration' },
  ],
  doctor: [
    { to: '/medication/orders', label: 'Coded medication orders', icon: Pill, group: 'Clinical' },
    { to: '/medication/witness', label: 'Witness inbox', icon: BadgeCheck, group: 'Clinical' },
    { to: '/lab/governed', label: 'Laboratory workspace', icon: TestTube, group: 'Clinical' },
    { to: '/doctor/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
    { to: '/hms/referrals', label: 'Referrals', icon: Repeat, group: 'Patients' },
    { to: '/hms/triage', label: 'Emergency triage', icon: HeartPulse, group: 'Patients' },
    { to: '/hms/adt', label: 'Beds and discharge', icon: BedDouble, group: 'Inpatient' },
    { to: '/hms/appointments', label: 'Consultation queue', icon: ListOrdered, group: 'Patients' },
    { to: '/hms/patients/search', label: 'Patients', icon: Search, group: 'Patients' },
    { to: '/hms/patients/new', label: 'Registration', icon: UserPlus, group: 'Patients' },
    { to: '/doctor/prescriptions', label: 'Prescriptions', icon: Pill, group: 'Clinical' },
    { to: '/doctor/referrals', label: 'Referrals', icon: Repeat, group: 'Clinical' },
    { to: '/doctor/rest-forms', label: 'Rest forms', icon: FilePlus2, group: 'Clinical' },
    { to: '/abdm/outside-records', label: 'Outside records', icon: FileInput, group: 'Patients' },
    { to: '/ipd/patients', label: 'Inpatients', icon: Hospital, group: 'Inpatient' },
    { to: '/ipd/requests', label: 'Admission requests', icon: Inbox, group: 'Inpatient' },
    { to: '/worklist', label: 'Worklist', icon: ListChecks, group: 'Inpatient' },
    { to: '/downtime', label: 'Downtime', icon: CloudOff, group: 'Inpatient' },
  ],
  nurse: [
    { to: '/medication/nursing', label: 'Medication administration and handover', icon: ClipboardList, group: 'Nursing' },
    { to: '/medication/stock', label: 'Ward stock and requisitions', icon: Package, group: 'Nursing' },
    { to: '/medication/controlled', label: 'Controlled drugs', icon: ShieldCheck, group: 'Nursing' },
    { to: '/medication/witness', label: 'Witness inbox', icon: BadgeCheck, group: 'Nursing' },
    { to: '/lab/governed', label: 'Laboratory workspace', icon: TestTube, group: 'Nursing' },
    { to: '/nurse/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
    { to: '/hms/triage', label: 'Emergency triage', icon: HeartPulse, group: 'Patients' },
    { to: '/hms/adt', label: 'Beds and discharge', icon: BedDouble, group: 'Inpatient' },
    { to: '/hms/vitals/entry', label: 'Triage & vitals', icon: HeartPulse, group: 'Patients' },
    { to: '/hms/patients/search', label: 'Patients', icon: Search, group: 'Patients' },
    { to: '/ipd/beds', label: 'Beds', icon: BedDouble, group: 'Inpatient' },
    { to: '/ipd/requests', label: 'Admission requests', icon: Inbox, group: 'Inpatient' },
    { to: '/ipd/billing', label: 'IPD billing', icon: Wallet, group: 'Finance' },
    { to: '/ipd/saved-bills', label: 'Unbilled charges', icon: FileText, group: 'Finance' },
    { to: '/worklist', label: 'Worklist', icon: ListChecks, group: 'Finance' },
    { to: '/downtime', label: 'Downtime', icon: CloudOff, group: 'Finance' },
  ],
  receptionist: [
    { to: '/receptionist/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
    { to: '/hms/patients/new', label: 'Registration', icon: UserPlus, group: 'Patients' },
    { to: '/hms/patients/duplicates', label: 'Possible duplicates', icon: Users, group: 'Patients' },
    { to: '/hms/triage', label: 'Emergency triage', icon: HeartPulse, group: 'Patients' },
    { to: '/hms/practitioners', label: 'Practitioners', icon: Stethoscope, group: 'Patients' },
    { to: '/hms/patients/search', label: 'Patients', icon: Search, group: 'Patients' },
    { to: '/receptionist/appointments', label: 'Appointments', icon: CalendarDays, group: 'Patients' },
    { to: '/hms/opd/token', label: 'OPD tokens', icon: Ticket, group: 'Patients', disabled: true },
    { to: '/receptionist/billing', label: 'OPD billing', icon: CreditCard, group: 'Front desk' },
    { to: '/billing/desk', label: 'Billing desk', icon: Wallet, group: 'Front desk' },
    { to: '/receptionist/visitors', label: 'Visitors', icon: Users, group: 'Front desk' },
    { to: '/receptionist/notifications', label: 'Alerts', icon: Bell, group: 'Front desk' },
    { to: '/abdm', label: 'ABDM', icon: BadgeCheck, group: 'Patients' },
    { to: '/worklist', label: 'Worklist', icon: ListChecks, group: 'Patients' },
    { to: '/downtime', label: 'Downtime', icon: CloudOff, group: 'Patients' },
  ],
  pharmacist: [
    { to: '/medication/pharmacy', label: 'Verification and coded dispensing', icon: Pill, group: 'Pharmacy' },
    { to: '/medication/catalogue', label: 'Medication catalogue', icon: BookOpen, group: 'Pharmacy' },
    { to: '/medication/stock', label: 'Locations and ward supply', icon: Package, group: 'Pharmacy' },
    { to: '/medication/controlled', label: 'Controlled drugs', icon: ShieldCheck, group: 'Pharmacy' },
    { to: '/medication/witness', label: 'Witness inbox', icon: BadgeCheck, group: 'Pharmacy' },
    { to: '/pharmacist/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
    { to: '/pharmacy/dispense', label: 'Dispense', icon: ClipboardList, group: 'Dispensing' },
    { to: '/pharmacy/otc', label: 'OTC sale', icon: ShoppingCart, group: 'Dispensing' },
    { to: '/pharmacy/returns', label: 'Returns', icon: Undo2, group: 'Dispensing' },
    { to: '/pharmacy/stock', label: 'Stock', icon: Package, group: 'Inventory' },
    { to: '/pharmacy/medicines', label: 'Medicines', icon: Pill, group: 'Inventory' },
    { to: '/pharmacy/expiry', label: 'Expiry', icon: Clock, group: 'Inventory' },
    { to: '/pharmacy/suppliers', label: 'Suppliers', icon: Factory, group: 'Procurement' },
    { to: '/pharmacy/pos', label: 'Purchase orders', icon: Truck, group: 'Procurement', disabled: true },
    { to: '/pharmacy/grn', label: 'Goods receipt', icon: Inbox, group: 'Procurement', disabled: true },
    { to: '/pharmacy/reports', label: 'Reports', icon: ChartColumn, group: 'Insights' },
    { to: '/worklist', label: 'Worklist', icon: ListChecks, group: 'Insights' },
    { to: '/downtime', label: 'Downtime', icon: CloudOff, group: 'Insights' },
  ],
  lab_technician: LAB,
};

export function navForRole(role) {
  return NAV_BY_ROLE[role] || LAB;
}

export function groupNav(links) {
  const groups = [];
  for (const link of links) {
    let g = groups.find((x) => x.name === link.group);
    if (!g) { g = { name: link.group, links: [] }; groups.push(g); }
    g.links.push(link);
  }
  return groups;
}

export function isLinkActive(link, pathname) {
  return pathname === link.to || (link.to !== '/' && pathname.startsWith(link.to + '/'));
}

// Roles that may open a patient's profile (matches the route guard in App.jsx)
export const PATIENT_PROFILE_ROLES = ['super_admin', 'admin', 'doctor', 'receptionist', 'nurse'];

export const ROLE_LABEL = {
  super_admin: 'Super admin', admin: 'Administrator', doctor: 'Doctor', nurse: 'Nurse',
  receptionist: 'Reception', pharmacist: 'Pharmacist', lab_technician: 'Lab technician',
};
