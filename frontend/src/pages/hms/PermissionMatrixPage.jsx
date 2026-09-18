import { useState, useEffect } from 'react';
import Navbar from '../../components/Navbar';
import api from '../../api/axios';
import toast from 'react-hot-toast';

const ROLES = ['super_admin', 'admin', 'doctor', 'lab_technician', 'receptionist', 'pharmacist', 'nurse'];
const MODULES = ['auth', 'dashboard', 'patient', 'consultation', 'lab', 'radiology', 'pharmacy', 'ipd', 'billing', 'reports', 'admin'];
const ACTIONS = ['can_read', 'can_write', 'can_edit', 'can_delete'];

export default function PermissionMatrixPage() {
  const [matrix, setMatrix] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/users/permissions')
      .then(res => {
        const data = res.data.data || [];
        const m = {};
        ROLES.forEach(r => {
          m[r] = {};
          MODULES.forEach(mod => {
            m[r][mod] = { can_read: 'N', can_write: 'N', can_edit: 'N', can_delete: 'N' };
          });
        });
        data.forEach(p => {
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
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (role, mod, action) => {
    setMatrix(prev => ({
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
      ROLES.forEach(role => {
        MODULES.forEach(mod => {
          permissions.push({
            role, module: mod,
            ...matrix[role][mod],
          });
        });
      });
      await api.put('/users/permissions', { permissions });
      toast.success('Permissions saved successfully!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const actionLabels = { can_read: 'R', can_write: 'W', can_edit: 'E', can_delete: 'D' };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-wrapper" style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="spinner" style={{ width: 36, height: 36 }} />
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="page-wrapper">
        <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1>🔐 Permission Matrix</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: 4 }}>
              Configure module access for each role. R=Read, W=Write, E=Edit, D=Delete
            </p>
          </div>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : '💾 Save Changes'}
          </button>
        </div>

        <div className="fade-up-2" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 900, fontSize: '0.78rem' }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: 'var(--surface-3)', zIndex: 2, minWidth: 120 }}>Role</th>
                {MODULES.map(mod => (
                  <th key={mod} colSpan={4} style={{ textAlign: 'center', borderLeft: '2px solid var(--border)' }}>
                    {mod}
                  </th>
                ))}
              </tr>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: 'var(--surface-3)', zIndex: 2 }}></th>
                {MODULES.map(mod => (
                  ACTIONS.map(act => (
                    <th key={`${mod}-${act}`} style={{
                      textAlign: 'center', fontSize: '0.65rem', padding: '4px 6px',
                      borderLeft: act === 'can_read' ? '2px solid var(--border)' : 'none',
                    }}>
                      {actionLabels[act]}
                    </th>
                  ))
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLES.map(role => (
                <tr key={role}>
                  <td style={{
                    position: 'sticky', left: 0, background: 'var(--surface)',
                    zIndex: 1, fontWeight: 600, textTransform: 'capitalize',
                  }}>
                    {role.replace(/_/g, ' ')}
                  </td>
                  {MODULES.map(mod => (
                    ACTIONS.map(act => (
                      <td key={`${role}-${mod}-${act}`} style={{
                        textAlign: 'center', padding: '6px 4px',
                        borderLeft: act === 'can_read' ? '2px solid var(--border)' : 'none',
                      }}>
                        <button
                          onClick={() => toggle(role, mod, act)}
                          style={{
                            width: 26, height: 26, borderRadius: 6,
                            border: '1.5px solid',
                            borderColor: matrix[role]?.[mod]?.[act] === 'Y' ? 'var(--green)' : 'var(--border)',
                            background: matrix[role]?.[mod]?.[act] === 'Y' ? 'var(--green-light)' : 'var(--surface)',
                            color: matrix[role]?.[mod]?.[act] === 'Y' ? 'var(--green)' : 'var(--text-muted)',
                            cursor: 'pointer', fontWeight: 700, fontSize: '0.7rem',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.15s',
                          }}
                        >
                          {matrix[role]?.[mod]?.[act] === 'Y' ? '✓' : '—'}
                        </button>
                      </td>
                    ))
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
