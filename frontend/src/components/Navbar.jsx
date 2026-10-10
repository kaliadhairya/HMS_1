import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  Search, Menu, PanelLeftClose, PanelLeftOpen, ChevronDown, KeyRound, Info, LogOut, Command as CommandIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from './ThemeToggle';
import DoctorQuickActionsDock from './DoctorQuickActionsDock';
import ReceptionistQuickActionsDock from './ReceptionistQuickActionsDock';
import ReferralTypeModal from './ReferralTypeModal';
import CommandPalette from './shell/CommandPalette';
import { navForRole, groupNav, isLinkActive, ROLE_LABEL } from './shell/navConfig';

const SIDEBAR_KEY = 'hms_sidebar_collapsed';

const titleFromPath = (pathname) => {
  const seg = pathname.split('/').filter((s) => s && !/^\d+$/.test(s)).pop() || 'Home';
  return seg.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
};

function showAbout() {
  toast.custom((t) => (
    <div className="about-toast" role="status">
      <h3><Info size={16} aria-hidden="true" /> HMS IT Department says</h3>
      <p>We designed and developed this Hospital Management System. Any Queries Contact us but not in Lunch Time 😊</p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => toast.dismiss(t.id)}>Got it</button>
    </div>
  ), { duration: 6000 });
}

// App chrome rendered by every page: fixed sidebar + sticky top bar + command palette.
export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isReferralModalOpen, setIsReferralModalOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
  });

  const role = user?.role || 'lab_technician';
  const links = navForRole(role);
  const groups = groupNav(links);
  const current = links.find((l) => isLinkActive(l, location.pathname));
  const displayName = role === 'doctor'
    ? `Dr. ${(user?.name || '').replace(/^Dr\.?\s*/i, '') || 'Doctor'}`
    : (user?.name || 'User');
  const initial = ((user?.name || '').replace(/^Dr\.?\s*/i, '') || 'U').charAt(0).toUpperCase();

  const handleLogout = () => { logout(); navigate('/login'); };

  useEffect(() => {
    document.body.classList.add('has-app-shell');
    return () => document.body.classList.remove('has-app-shell', 'sidebar-collapsed');
  }, []);

  useEffect(() => {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  }, [collapsed]);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleNavClick = (e, link) => {
    if (link.to === '/doctor/referrals') {
      e.preventDefault();
      setIsReferralModalOpen(true);
    }
  };

  const renderLink = (link) => {
    const Icon = link.icon;
    const active = isLinkActive(link, location.pathname);
    const inner = (
      <>
        <Icon size={18} strokeWidth={1.9} className="nav-icon" aria-hidden="true" />
        <span className="nav-label">{link.label}</span>
      </>
    );
    const el = link.disabled ? (
      <span className="nav-item is-disabled" aria-disabled="true" title="Not available yet">{inner}</span>
    ) : (
      <Link
        to={link.to}
        className={`nav-item${active ? ' is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={(e) => handleNavClick(e, link)}
      >
        {inner}
      </Link>
    );
    if (!collapsed) return <li key={link.to + link.label}>{el}</li>;
    return (
      <li key={link.to + link.label}>
        <Tooltip.Root delayDuration={150}>
          <Tooltip.Trigger asChild>{el}</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="right" sideOffset={8} className="tooltip">{link.label}</Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </li>
    );
  };

  return (
    <Tooltip.Provider>
      <aside className={`app-sidebar${mobileOpen ? ' is-open' : ''}`} aria-label="Main navigation">
        <Link to={links[0]?.to || '/dashboard'} className="sidebar-brand">
          <img src="/logo.png?v=3" alt="" className="sidebar-logo" />
          <span className="sidebar-brand-text">
            <strong>HMS Hospital</strong>
            <span>Hospital Management</span>
          </span>
        </Link>

        <nav className="sidebar-nav">
          {groups.map((g) => (
            <div className="nav-group" key={g.name}>
              <div className="nav-group-title">{g.name}</div>
              <ul>{g.links.map(renderLink)}</ul>
            </div>
          ))}
        </nav>

        <button
          type="button"
          className="sidebar-collapse"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          <span className="nav-label">Collapse</span>
        </button>
      </aside>
      {mobileOpen && <div className="app-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />}

      <header className="app-topbar">
        <button type="button" className="icon-btn topbar-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
          <Menu size={20} />
        </button>

        <div className="topbar-crumbs" aria-label="Breadcrumb">
          {current && current.group !== current.label ? (
            <>
              <span className="crumb-muted">{current.group}</span>
              <span className="crumb-sep" aria-hidden="true">/</span>
              <span className="crumb-current">{current.label}</span>
            </>
          ) : (
            <span className="crumb-current">{current ? current.label : titleFromPath(location.pathname)}</span>
          )}
        </div>

        <button type="button" className="topbar-search" onClick={() => setPaletteOpen(true)}>
          <Search size={16} aria-hidden="true" />
          <span>Search patients, pages…</span>
          <kbd className="kbd"><CommandIcon size={11} aria-hidden="true" />K</kbd>
        </button>

        <div className="topbar-actions">
          <ThemeToggle />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="user-trigger" aria-label="Account menu">
                <span className="avatar">{initial}</span>
                <span className="user-trigger-text">
                  <strong>{displayName}</strong>
                  <span>{ROLE_LABEL[role] || role}</span>
                </span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu" align="end" sideOffset={8}>
                <div className="menu-header">
                  <strong>{user?.name}</strong>
                  <span>{user?.username} · {ROLE_LABEL[role] || role}</span>
                </div>
                <DropdownMenu.Separator className="menu-sep" />
                <DropdownMenu.Item className="menu-item" onSelect={() => navigate('/hms/change-password')}>
                  <KeyRound size={16} aria-hidden="true" /> Change password
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={showAbout}>
                  <Info size={16} aria-hidden="true" /> About
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="menu-sep" />
                <DropdownMenu.Item className="menu-item is-danger" onSelect={handleLogout}>
                  <LogOut size={16} aria-hidden="true" /> Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} role={role} onSignOut={handleLogout} />

      {role === 'doctor' && <DoctorQuickActionsDock />}
      {role === 'receptionist' && <ReceptionistQuickActionsDock />}

      <ReferralTypeModal
        isOpen={isReferralModalOpen}
        onClose={() => setIsReferralModalOpen(false)}
      />
    </Tooltip.Provider>
  );
}
