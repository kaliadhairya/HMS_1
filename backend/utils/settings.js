module.exports = {
  maintenance_mode: false,
  maintenance_message: 'System is under maintenance. Please try again later.',
  ip_whitelist: [],
  ip_blacklist: [],
  session_timeout: { super_admin: 30, admin: 30, doctor: 60, nurse: 60, receptionist: 60, pharmacist: 60, lab_technician: 60 },
  twofa_enforced_roles: [],
  announcements: [],
  api_keys: [],
};
