import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import ThemeToggle from './ThemeToggle';
import DoctorQuickActionsDock from './DoctorQuickActionsDock';
import ReceptionistQuickActionsDock from './ReceptionistQuickActionsDock';
import ReferralTypeModal from './ReferralTypeModal';

const LAB_NAV_LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { to: '/lab/queue', label: 'Test Queue', shortLabel: 'Queue', icon: '🧪' },
  { to: '/lab/samples', label: 'Samples', icon: '🩸' },
  { to: '/lab/results', label: 'Results Entry', shortLabel: 'Results', icon: '📝' },
  { to: '/lab/reports', label: 'Reports', icon: '📄' },
  { to: '/search', label: 'Search', icon: '🔍' },
  { to: '/lab/workload', label: 'Workload', icon: '📈' },
];

const HMS_NAV_PER_ROLE = {
  super_admin: [
    { to: '/super_admin/dashboard', label: 'Dashboard', icon: '🏠' },
    { to: '/pharmacy/medicines', label: 'Medicines', icon: '💊' },
    { to: '/hms/patients/search', label: 'Patient Search', shortLabel: 'Patients', icon: '🔍' },
    { to: '/hms/admin/users', label: 'Users', icon: '👥' },
    { to: '/hms/admin/security', label: 'Security', icon: '🔐' },
    { to: '/reports', label: 'Reports', icon: '📊' },
    { to: '/admin/settings', label: 'Settings', icon: '⚙️' },
  ],
  nurse: [
    { to: '/nurse/dashboard', label: 'Dashboard', icon: '🏠' },
    { to: '/hms/vitals/entry', label: 'Triage / Vitals', shortLabel: 'Vitals', icon: '❤️' },
    { to: '/hms/patients/search', label: 'Patients', icon: '🔍' },
    { to: '/ipd/beds', label: 'IPD/Beds', shortLabel: 'Beds', icon: '🛏️' },
    { to: '/ipd/requests', label: 'IPD Requests', shortLabel: 'Requests', icon: '📥' },
    { to: '/ipd/billing', label: 'IPD Billing', shortLabel: 'Billing', icon: '💰' },
    { to: '/ipd/saved-bills', label: 'Saved Bills', shortLabel: 'Saved', icon: '📝' },
  ],
  lab_technician: LAB_NAV_LINKS,
  admin: [
    { to: '/admin/dashboard', label: 'Dashboard', icon: '🏠' },
    { to: '/pharmacy/medicines', label: 'Medicines', icon: '💊' },
    { to: '/hms/admin/staff', label: 'Staff', icon: '👥' },
    { to: '/hms/admin/patients', label: 'Patients', icon: '🏥' },
    { to: '/hms/appointments', label: 'Appointments', icon: '📅' },
    { to: '/hms/admin/bed-management', label: 'Bed Management', shortLabel: 'Beds', icon: '🛏️' },
    { to: '/hms/admin/billing', label: 'Billing', icon: '💳' },
    { to: '/hms/admin/pharmacy', label: 'Pharmacy', icon: '💊' },
    { to: '/reports', label: 'Reports', icon: '📊' },
    { to: '/admin/settings', label: 'Settings', icon: '⚙️' },
  ],
  doctor: [
    { to: '/doctor/dashboard', label: 'Dashboard', icon: '🏠' },
    { to: '/hms/patients/new', label: 'Registration', icon: '📝' },
    { to: '/hms/appointments', label: 'Consultation Queue', shortLabel: 'Queue', icon: '👥' },
    { to: '/hms/patients/search', label: 'Patient Search', shortLabel: 'Patients', icon: '🔍' },
    { to: '/doctor/prescriptions', label: 'Prescription Hub', shortLabel: 'Prescription Hub', icon: '💊' },
    { to: '/doctor/referrals', label: 'Referrals Hub', shortLabel: 'Referrals', icon: '🔄' },
    { to: '/doctor/rest-forms', label: 'Rest Forms Hub', shortLabel: 'Rest Forms', icon: '🛏️' },
    { to: '/ipd/patients', label: 'IPD Hub', shortLabel: 'IPD', icon: '🏥' },
    { to: '/ipd/requests', label: 'IPD Requests', shortLabel: 'Requests', icon: '📥' },
  ],
  receptionist: [
    { to: '/receptionist/dashboard', label: 'Dashboard', icon: '🏠' },
    { to: '/hms/patients/new', label: 'Registration', icon: '📝' },
    { to: '/hms/opd/token', label: 'OPD Token', icon: '🎫', disabled: true },
    { to: '/receptionist/appointments', label: 'Appointments', icon: '📅' },
    { to: '/hms/patients/search', label: 'Patient Search', shortLabel: 'Patients', icon: '🔍' },
    { to: '/receptionist/visitors', label: 'Visitors', icon: '👥' },
    { to: '/receptionist/notifications', label: 'Alerts', icon: '🔔' },
  ],
  pharmacist: [
    { to: '/pharmacist/dashboard', label: 'Dashboard', icon: '🏠' },
    { to: '/pharmacy/medicines', label: 'Medicines', icon: '💊' },
    { to: '/pharmacy/suppliers', label: 'Suppliers', icon: '🏭' },
    { to: '/pharmacy/pos', label: 'Purchase Orders', shortLabel: 'PO', icon: '📋', disabled: true },
    { to: '/pharmacy/grn', label: 'GRN', icon: '📥', disabled: true },
    { to: '/pharmacy/stock', label: 'Stock', icon: '📦' },
    { to: '/pharmacy/dispense', label: 'Dispense', icon: '📝' },
    { to: '/pharmacy/otc', label: 'OTC Sale', shortLabel: 'OTC', icon: '🛒' },
    { to: '/pharmacy/returns', label: 'Returns', icon: '↩️' },
    { to: '/pharmacy/expiry', label: 'Expiry', icon: '⏰' },
    { to: '/pharmacy/reports', label: 'Reports', icon: '📊' },
  ],
};

const ROLE_BADGE_COLORS = {
  super_admin: { bg: 'rgba(248,113,113,0.15)', color: '#f87171', border: 'rgba(248,113,113,0.3)' },
  admin: { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: 'rgba(251,191,36,0.3)' },
  doctor: { bg: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: 'rgba(96,165,250,0.3)' },
  lab_technician: { bg: 'rgba(52,211,153,0.15)', color: '#34d399', border: 'rgba(52,211,153,0.3)' },
  receptionist: { bg: 'rgba(168,85,247,0.15)', color: '#a855f7', border: 'rgba(168,85,247,0.3)' },
  pharmacist: { bg: 'rgba(45,212,191,0.15)', color: '#2dd4bf', border: 'rgba(45,212,191,0.3)' },
  nurse: { bg: 'rgba(244,114,182,0.15)', color: '#f472b6', border: 'rgba(244,114,182,0.3)' },
};

const getLabel = (link) => link.shortLabel || link.label;
const PRIMARY_NAV_LIMIT_BY_ROLE = {
  doctor: 5,
};

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isReferralModalOpen, setIsReferralModalOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const handleLogout = () => { logout(); navigate('/login'); };

  const role = user?.role || 'lab_technician';
  const isHMSPath = role !== 'lab_technician';
  const navLinks = HMS_NAV_PER_ROLE[role] || LAB_NAV_LINKS;
  const activeLinks = navLinks;
  const badgeStyle = ROLE_BADGE_COLORS[role] || ROLE_BADGE_COLORS.lab_technician;
  const primaryNavLimit = PRIMARY_NAV_LIMIT_BY_ROLE[role] || 6;
  const primaryCount = activeLinks.length > primaryNavLimit ? primaryNavLimit : activeLinks.length;
  const primaryLinks = activeLinks.slice(0, primaryCount);
  const moreLinks = activeLinks.slice(primaryCount);
  const homeLink = activeLinks[0]?.to || `/${role}/dashboard`;

  useEffect(() => {
    setIsMoreOpen(false);
    setIsMobileOpen(false);
  }, [location.pathname]);

  const isActive = (link) => (
    location.pathname === link.to ||
    (link.to !== '/' && location.pathname.startsWith(link.to))
  );

  const handleNavClick = (e, link) => {
    if (link.to === '/doctor/referrals') {
      e.preventDefault();
      setIsReferralModalOpen(true);
    }
    setIsMoreOpen(false);
    setIsMobileOpen(false);
  };

  const renderNavItem = (link, options = {}) => {
    const active = isActive(link);
    const className = [
      'navbar-link',
      active ? 'is-active' : '',
      link.disabled ? 'is-disabled' : '',
      options.inMenu ? 'navbar-menu-link' : '',
    ].filter(Boolean).join(' ');

    if (link.disabled) {
      return (
        <span
          key={link.to + link.label}
          className={className}
          title="This feature is currently disabled"
          aria-disabled="true"
        >
          <span className="navbar-link-icon">{link.icon}</span>
          <span className="navbar-link-label">{getLabel(link)}</span>
        </span>
      );
    }

    return (
      <Link
        key={link.to + link.label}
        to={link.to}
        className={className}
        title={link.label}
        aria-current={active ? 'page' : undefined}
        onClick={(e) => handleNavClick(e, link)}
      >
        <span className="navbar-link-icon">{link.icon}</span>
        <span className="navbar-link-label">{getLabel(link)}</span>
      </Link>
    );
  };

  const moreActive = moreLinks.some(isActive);

  return (
    <>
      <nav className="navbar-shell">
        <div className="navbar-inner">
          <Link to={homeLink} className="navbar-brand" aria-label="Go to dashboard">
            <img src="/logo.png" alt="HMS Logo" className="navbar-logo" />
            <div className="navbar-brand-copy">
              <div className="navbar-brand-name">HMS Hospital</div>
              <div className="navbar-brand-subtitle">{isHMSPath ? 'HMS' : 'Lab System'}</div>
            </div>
          </Link>

          <button
            type="button"
            className={`navbar-mobile-toggle ${isMobileOpen ? 'is-active' : ''}`}
            onClick={() => setIsMobileOpen(open => !open)}
            aria-label="Toggle navigation menu"
            aria-expanded={isMobileOpen}
          >
            <span />
            <span />
            <span />
          </button>

          <div className="navbar-separator" />

          <div className={`navbar-links ${isMobileOpen ? 'is-open' : ''}`}>
            {primaryLinks.map(link => renderNavItem(link))}

            {moreLinks.length > 0 && (
              <div className="navbar-more">
                <button
                  type="button"
                  className={`navbar-more-button ${moreActive ? 'is-active' : ''}`}
                  onClick={() => setIsMoreOpen(open => !open)}
                  aria-expanded={isMoreOpen}
                  aria-haspopup="menu"
                >
                  <span className="navbar-link-icon">⋯</span>
                  <span className="navbar-link-label">More</span>
                </button>
                {isMoreOpen && (
                  <div className="navbar-more-menu" role="menu">
                    {moreLinks.map(link => renderNavItem(link, { inMenu: true }))}
                  </div>
                )}
              </div>
            )}

            {role === 'lab_technician' && !isHMSPath && user?.role === 'admin' && (
              <Link to="/admin" className="navbar-link" title="Admin Panel">
                <span className="navbar-link-icon">🛡️</span>
                <span className="navbar-link-label">Admin</span>
              </Link>
            )}
          </div>

          <div className="navbar-actions">
            <ThemeToggle />

            <div className="navbar-user-chip">
              <div className="navbar-avatar">
                {user?.name?.charAt(0).toUpperCase()}
              </div>
              <div className="navbar-user-meta">
                <div className="navbar-user-name">{user?.name?.split(' ')[0]}</div>
                <div
                  className="navbar-role-badge"
                  style={{
                    '--role-bg': badgeStyle.bg,
                    '--role-color': badgeStyle.color,
                    '--role-border': badgeStyle.border,
                  }}
                >
                  {role?.replace(/_/g, ' ')}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                toast.custom((t) => (
                  <div style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--primary)',
                    padding: '20px 24px',
                    borderRadius: '12px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                    maxWidth: '400px',
                    animation: t.visible ? 'hmsSlideDown 0.3s cubic-bezier(0.16,1,0.3,1)' : 'hmsFadeOut 0.3s',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    <h3 style={{ margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8, fontSize: '1rem' }}>
                      <span style={{
                        background: 'rgba(59,130,246,0.1)', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6
                      }}>⚡</span>
                      HMS IT Department
                    </h3>
                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                      Hospital Management System — Designed and developed for streamlined healthcare operations.
                    </p>
                    <button
                      onClick={() => toast.dismiss(t.id)}
                      style={{
                        marginTop: 12, padding: '6px 16px', background: 'var(--surface-3)', border: '1px solid var(--border)',
                        borderRadius: 6, cursor: 'pointer', alignSelf: 'flex-end', fontSize: '0.8rem', fontWeight: 600
                      }}
                    >
                      Got it
                    </button>
                  </div>
                ), { duration: 6000 });
              }}
              className="navbar-action-button navbar-about-button"
            >
              <span>ℹ️</span>
              <span className="navbar-action-label">About</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="navbar-action-button navbar-logout-button"
            >
              <span className="navbar-action-label">Sign Out</span>
              <span className="navbar-logout-icon">↗</span>
            </button>
          </div>
        </div>
      </nav>

      {role === 'doctor' && <DoctorQuickActionsDock />}
      {role === 'receptionist' && <ReceptionistQuickActionsDock />}

      <ReferralTypeModal
        isOpen={isReferralModalOpen}
        onClose={() => setIsReferralModalOpen(false)}
      />
    </>
  );
}
