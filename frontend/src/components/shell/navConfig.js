import {
  LayoutDashboard, Search, UserPlus, Pill, Users, BedDouble, Inbox, ChartColumn, CalendarDays, Hospital,
  Settings, Droplet, TestTube, ShoppingCart, Bell, ShieldCheck, Repeat, Package, ClipboardList, ChartLine,
  FileText, CreditCard, Wallet, Factory, Ticket, HeartPulse, Clock, Undo2, ListOrdered, FilePlus2, Truck,
} from 'lucide-react';

// Navigation per role. `group` drives the sidebar sections.
const LAB = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
  { to: '/lab/queue', label: 'Test queue', icon: TestTube, group: 'Laboratory' },
  { to: '/lab/samples', label: 'Samples', icon: Droplet, group: 'Laboratory' },
  { to: '/lab/results', label: 'Results entry', icon: ClipboardList, group: 'Laboratory' },
  { to: '/lab/reports', label: 'Reports', icon: FileText, group: 'Laboratory' },
  { to: '/lab/workload', label: 'Workload', icon: ChartLine, group: 'Laboratory' },
  { to: '/search', label: 'Search', icon: Search, group: 'Patients' },
];

export const NAV_BY_ROLE = {
  super_admin: [
    { to: '/super_admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
    { to: '/hms/patients/search', label: 'Patients', icon: Search, group: 'Patients' },
    { to: '/pharmacy/medicines', label: 'Medicines', icon: Pill, group: 'Pharmacy' },
    { to: '/reports', label: 'Reports', icon: ChartColumn, group: 'Insights' },
    { to: '/hms/admin/users', label: 'Users', icon: Users, group: 'Administration' },
    { to: '/hms/admin/security', label: 'Security', icon: ShieldCheck, group: 'Administration' },
    { to: '/admin/settings', label: 'Settings', icon: Settings, group: 'Administration' },
  ],
  admin: [
    { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
    { to: '/hms/admin/patients', label: 'Patients', icon: Hospital, group: 'Patients' },
    { to: '/hms/appointments', label: 'Appointments', icon: CalendarDays, group: 'Patients' },
    { to: '/hms/admin/bed-management', label: 'Bed management', icon: BedDouble, group: 'Inpatient' },
    { to: '/hms/admin/pharmacy', label: 'Pharmacy', icon: Package, group: 'Pharmacy' },
    { to: '/pharmacy/medicines', label: 'Medicines', icon: Pill, group: 'Pharmacy' },
    { to: '/hms/admin/billing', label: 'Billing', icon: CreditCard, group: 'Finance' },
    { to: '/reports', label: 'Reports', icon: ChartColumn, group: 'Insights' },
    { to: '/hms/admin/staff', label: 'Staff', icon: Users, group: 'Administration' },
    { to: '/admin/settings', label: 'Settings', icon: Settings, group: 'Administration' },
  ],
  doctor: [
    { to: '/doctor/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
    { to: '/hms/appointments', label: 'Consultation queue', icon: ListOrdered, group: 'Patients' },
    { to: '/hms/patients/search', label: 'Patients', icon: Search, group: 'Patients' },
    { to: '/hms/patients/new', label: 'Registration', icon: UserPlus, group: 'Patients' },
    { to: '/doctor/prescriptions', label: 'Prescriptions', icon: Pill, group: 'Clinical' },
    { to: '/doctor/referrals', label: 'Referrals', icon: Repeat, group: 'Clinical' },
    { to: '/doctor/rest-forms', label: 'Rest forms', icon: FilePlus2, group: 'Clinical' },
    { to: '/ipd/patients', label: 'Inpatients', icon: Hospital, group: 'Inpatient' },
    { to: '/ipd/requests', label: 'Admission requests', icon: Inbox, group: 'Inpatient' },
  ],
  nurse: [
    { to: '/nurse/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
    { to: '/hms/vitals/entry', label: 'Triage & vitals', icon: HeartPulse, group: 'Patients' },
    { to: '/hms/patients/search', label: 'Patients', icon: Search, group: 'Patients' },
    { to: '/ipd/beds', label: 'Beds', icon: BedDouble, group: 'Inpatient' },
    { to: '/ipd/requests', label: 'Admission requests', icon: Inbox, group: 'Inpatient' },
    { to: '/ipd/billing', label: 'IPD billing', icon: Wallet, group: 'Finance' },
    { to: '/ipd/saved-bills', label: 'Saved bills', icon: FileText, group: 'Finance' },
  ],
  receptionist: [
    { to: '/receptionist/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
    { to: '/hms/patients/new', label: 'Registration', icon: UserPlus, group: 'Patients' },
    { to: '/hms/patients/search', label: 'Patients', icon: Search, group: 'Patients' },
    { to: '/receptionist/appointments', label: 'Appointments', icon: CalendarDays, group: 'Patients' },
    { to: '/hms/opd/token', label: 'OPD tokens', icon: Ticket, group: 'Patients', disabled: true },
    { to: '/receptionist/visitors', label: 'Visitors', icon: Users, group: 'Front desk' },
    { to: '/receptionist/notifications', label: 'Alerts', icon: Bell, group: 'Front desk' },
  ],
  pharmacist: [
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
