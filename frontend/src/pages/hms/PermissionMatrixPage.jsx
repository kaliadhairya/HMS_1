import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import Navbar from '../../components/Navbar';
import PageHeader from '../../components/ui/PageHeader';
import api from '../../api/axios';
import toast from 'react-hot-toast';

const ROLES = ['super_admin', 'admin', 'doctor', 'lab_technician', 'receptionist', 'pharmacist', 'nurse'];
const MODULES = ['auth', 'dashboard', 'patient', 'consultation', 'lab', 'radiology', 'pharmacy', 'ipd', 'billing', 'reports', 'admin'];
const ACTIONS = ['can_read', 'can_write', 'can_edit', 'can_delete'];

const ROLE_LABEL = {
  super_admin: 'Super admin', admin: 'Administrator', doctor: 'Doctor', lab_technician: 'Lab technician',
  receptionist: 'Receptionist', pharmacist: 'Pharmacist', nurse: 'Nurse',
};
const MODULE_LABEL = {
  auth: 'Auth', dashboard: 'Dashboard', patient: 'Patient', consultation: 'Consultation', lab: 'Lab', radiology: 'Radiology',
  pharmacy: 'Pharmacy', ipd: 'IPD', billing: 'Billing', reports: 'Reports', admin: 'Admin',
};
const ACTION_SHORT = { can_read: 'R', can_write: 'W', can_edit: 'E', can_delete: 'D' };
const ACTION_NAME = { can_read: 'Read', can_write: 'Write', can_edit: 'Edit', can_delete: 'Delete' };

const groupStart = { borderLeft: '1px solid var(--border-dark)' };
const stickyCell = { position: 'sticky', left: 0, zIndex: 1, background: 'var(--surface)', minWidth: 140 };

export default function PermissionMatrixPage() {
  const [matrix, setMatrix] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/users/permissions')
      .then((res) => {
        const data = res.data.data || [];
        const m = {};
        ROLES.forEach((r) => {
          m[r] = {};
          MODULES.forEach((mod) => {
            m[r][mod] = { can_read: 'N', can_write: 'N', can_edit: 'N', can_delete: 'N' };
          });
        });
        data.forEach((p) => {
          if (m[p.role] && m[p.role][p.module]) {
            m[p.role][p.module] = {
              can_read: p.can_read || 'N',
              can_write: p.can_write || 'N',
              can_edit: p.can_edit || 'N',
              can_delete: p.can_delete || 'N',
            };
          }
        });
        setMatrix(m);
      })
      .catch((err) => {
        console.error(err);
        toast.error('Could not load permissions');
      })
      .finally(() => setLoading(false));
  }, []);

  const toggle = (role, mod, action) => {
    setMatrix((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [mod]: {
          ...prev[role][mod],
          [action]: prev[role][mod][action] === 'Y' ? 'N' : 'Y',
        },
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const permissions = [];
      ROLES.forEach((role) => {
        MODULES.forEach((mod) => {
          permissions.push({
            role, module: mod,
            ...matrix[role][mod],
          });
        });
      });
      await api.put('/users/permissions', { permissions });
      toast.success('Permissions saved');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Permission matrix"
          description="Module access for each role. Changes apply after you save."
          meta={(
            <span className="muted">
              {ACTIONS.map((a, i) => <span key={a}>{i > 0 ? ' · ' : ''}<strong>{ACTION_SHORT[a]}</strong> {ACTION_NAME[a]}</span>)}
            </span>
          )}
          actions={(
            <button type="button" className="btn btn-primary btn-md" onClick={handleSave} disabled={saving || loading}>
              <Save size={16} aria-hidden="true" /> {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
        />

        <section className="panel">
          {loading ? (
            <div className="panel-pad"><p className="muted">Loading…</p></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="mini-table" style={{ minWidth: 980, fontSize: '0.8rem' }}>
                <caption className="sr-only">Permissions by role and module</caption>
                <thead>
                  <tr>
                    <th scope="col" rowSpan={2} style={{ ...stickyCell, zIndex: 2, background: 'var(--surface-2)', verticalAlign: 'bottom' }}>Role</th>
                    {MODULES.map((mod) => (
                      <th key={mod} scope="colgroup" colSpan={4} style={{ ...groupStart, textAlign: 'center', background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                        {MODULE_LABEL[mod] || mod}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {MODULES.map((mod) => (
                      ACTIONS.map((act) => (
                        <th
                          key={`${mod}-${act}`}
                          scope="col"
                          style={{ textAlign: 'center', padding: '4px 6px', background: 'var(--surface-2)', ...(act === 'can_read' ? groupStart : null) }}
                        >
                          <abbr title={ACTION_NAME[act]} style={{ textDecoration: 'none' }}>{ACTION_SHORT[act]}</abbr>
                        </th>
                      ))
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROLES.map((role) => (
                    <tr key={role}>
                      <th scope="row" style={{ ...stickyCell, fontWeight: 600, fontSize: '0.84rem', textTransform: 'none', letterSpacing: 0, color: 'var(--text-primary)', padding: 8, borderBottom: '1px solid var(--border)' }}>
                        {ROLE_LABEL[role] || role.replace(/_/g, ' ')}
                      </th>
                      {MODULES.map((mod) => (
                        ACTIONS.map((act) => {
                          const checked = matrix[role]?.[mod]?.[act] === 'Y';
                          return (
                            <td
                              key={`${role}-${mod}-${act}`}
                              style={{ textAlign: 'center', padding: '6px 4px', background: checked ? 'var(--primary-light)' : undefined, ...(act === 'can_read' ? groupStart : null) }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggle(role, mod, act)}
                                aria-label={`${ROLE_LABEL[role] || role}: ${ACTION_NAME[act]} ${MODULE_LABEL[mod] || mod}`}
                                style={{ width: 16, height: 16, accentColor: 'var(--primary)', cursor: 'pointer', margin: 0 }}
                              />
                            </td>
                          );
                        })
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
