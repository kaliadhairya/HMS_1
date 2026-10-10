import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { Search, UserRound, CornerDownLeft, UserPlus, KeyRound, LogOut, MoonStar } from 'lucide-react';
import api from '../../api/axios';
import { navForRole, PATIENT_PROFILE_ROLES } from './navConfig';
import { useTheme } from '../../context/ThemeContext';

const patientId = (p) => p.id ?? p.ID;
const patientValue = (p) => `patient ${patientId(p)} ${p.name} ${p.uhid} ${p.phoneNumber || ''}`;

// Patients are already matched by the server; pages and actions match by plain substring
// (fuzzy matching made "sharma" hit "/pharmacy").
const filterItems = (value, search) => {
  if (value.startsWith('patient ')) return 1;
  return value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0;
};

export default function CommandPalette({ open, onOpenChange, role, onSignOut }) {
  const navigate = useNavigate();
  const { toggleTheme: flipTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState('');
  const canOpenPatients = PATIENT_PROFILE_ROLES.includes(role);
  const links = navForRole(role).filter((l) => !l.disabled);

  // Live patient lookup (debounced)
  useEffect(() => {
    if (!open || !canOpenPatients) return undefined;
    const q = query.trim();
    if (q.length < 2) { setPatients([]); return undefined; }
    setSearching(true);
    const timer = setTimeout(() => {
      api.get(`/patients/search?q=${encodeURIComponent(q)}&limit=8`)
        .then((res) => setPatients(res.data.data || []))
        .catch(() => setPatients([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open, canOpenPatients]);

  useEffect(() => { if (!open) { setQuery(''); setPatients([]); } }, [open]);

  // Patients arrive after the page list has rendered: put the top patient under the cursor
  useEffect(() => {
    if (patients.length) setSelected(patientValue(patients[0]));
  }, [patients]);

  const go = (to) => { onOpenChange(false); navigate(to); };
  const toggleTheme = () => { flipTheme(); onOpenChange(false); };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Search patients and pages"
      className="cmdk"
      filter={filterItems}
      value={selected}
      onValueChange={setSelected}
      overlayClassName="cmdk-overlay"
      contentClassName="cmdk-content"
    >
      <div className="cmdk-input-row">
        <Search size={18} aria-hidden="true" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={canOpenPatients ? 'Search patients by name, UHID or phone, or jump to a page…' : 'Jump to a page or action…'}
        />
        <kbd className="kbd">Esc</kbd>
      </div>
      <Command.List className="cmdk-list">
        <Command.Empty className="cmdk-empty">{searching ? 'Searching…' : 'No results.'}</Command.Empty>

        {canOpenPatients && patients.length > 0 && (
          <Command.Group heading="Patients">
            {patients.map((p) => (
              <Command.Item
                key={patientId(p)}
                value={patientValue(p)}
                onSelect={() => go(`/hms/patients/${patientId(p)}`)}
              >
                <span className="cmdk-avatar">{(p.name || '?').charAt(0).toUpperCase()}</span>
                <span className="cmdk-main">
                  <span className="cmdk-title">{p.name}</span>
                  <span className="cmdk-sub">{p.uhid} · {p.age ?? '–'}y · {p.gender || '–'}{p.phoneNumber ? ` · ${p.phoneNumber}` : ''}</span>
                </span>
                <CornerDownLeft size={14} className="cmdk-enter" aria-hidden="true" />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Go to">
          {links.map(({ to, label, icon: Icon }) => (
            <Command.Item key={to + label} value={`page ${label}`} onSelect={() => go(to)}>
              <Icon size={16} aria-hidden="true" /> <span className="cmdk-title">{label}</span>
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Actions">
          {['super_admin', 'admin', 'doctor', 'receptionist'].includes(role) && (
            <Command.Item value="action register new patient" onSelect={() => go('/hms/patients/new')}>
              <UserPlus size={16} aria-hidden="true" /> <span className="cmdk-title">Register new patient</span>
            </Command.Item>
          )}
          <Command.Item value="action toggle dark theme" onSelect={toggleTheme}>
            <MoonStar size={16} aria-hidden="true" /> <span className="cmdk-title">Toggle dark mode</span>
          </Command.Item>
          <Command.Item value="action change password" onSelect={() => go('/hms/change-password')}>
            <KeyRound size={16} aria-hidden="true" /> <span className="cmdk-title">Change password</span>
          </Command.Item>
          <Command.Item value="action sign out logout" onSelect={() => { onOpenChange(false); onSignOut(); }}>
            <LogOut size={16} aria-hidden="true" /> <span className="cmdk-title">Sign out</span>
          </Command.Item>
        </Command.Group>
      </Command.List>
      <div className="cmdk-footer">
        <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> to move</span>
        <span><kbd className="kbd">↵</kbd> to open</span>
        <span className="cmdk-footer-right"><UserRound size={13} aria-hidden="true" /> Patient search uses UHID, name or phone</span>
      </div>
    </Command.Dialog>
  );
}
