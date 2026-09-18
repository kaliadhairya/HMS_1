import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';

export default function IPDPatientListPage() {
  const [admissions, setAdmissions] = useState([]);
  const [statusFilter, setStatusFilter] = useState('Active');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchAdmissions = async () => {
    try {
      const res = await api.get(`/ipd/admissions?status=${statusFilter}`);
      setAdmissions(res.data.data);
    } catch (err) {
      toast.error('Failed to fetch admissions');
    }
  };

  useEffect(() => {
    fetchAdmissions();
  }, [statusFilter]);

  const filteredAdmissions = admissions.filter(adm => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (adm.PATIENT_NAME || adm.patientName || '').toLowerCase().includes(q) ||
      (adm.UHID || '').toLowerCase().includes(q) ||
      (adm.ADMISSION_ID_FORMATTED || adm.admissionIdFormatted || '').toLowerCase().includes(q) ||
      (adm.DOCTOR_NAME || '').toLowerCase().includes(q) ||
      (adm.DEPARTMENT || '').toLowerCase().includes(q)
    );
  });

  return (
    <>
    <Navbar />
      <div className="container py-4" style={{ maxWidth: '100%' }}>
        {/* Page Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon">🏥</span>
              IPD Patients Hub
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Manage currently admitted patients, view charts, and handle discharges.
            </p>
          </div>
        </div>

        {/* Search & Filter Premium */}
        <div className="hms-anim-2" style={{ marginBottom: 24, display: 'flex', gap: 20 }}>
          {/* Search Bar */}
          <div className="card" style={{ 
            padding: '12px 24px', 
            borderRadius: 40,
            boxShadow: 'var(--shadow-md)',
            border: '2.5px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            transition: 'all 0.3s ease',
            flex: 1,
          }}
          onFocusCapture={e => e.currentTarget.style.borderColor = 'var(--blue)'}
          onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <span style={{ fontSize: '1.4rem', filter: 'grayscale(0.5)' }}>🔍</span>
            <input
              type="text"
              className="form-input"
              style={{ 
                fontSize: '1.1rem', 
                border: 'none', 
                boxShadow: 'none', 
                background: 'transparent',
                padding: '4px 0',
                flex: 1,
                minWidth: 0
              }}
              placeholder="Search by UHID, Patient Name, Doctor, or Department..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          {/* Filter Dropdown */}
          <div className="card" style={{ 
            padding: '12px 24px', 
            borderRadius: 40,
            boxShadow: 'var(--shadow-md)',
            border: '2.5px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            transition: 'all 0.3s ease',
            width: 280,
            flexShrink: 0
          }}
          onFocusCapture={e => e.currentTarget.style.borderColor = 'var(--green)'}
          onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <span style={{ fontSize: '1.3rem', filter: 'grayscale(0.5)' }}>🛏️</span>
            <select 
              className="form-input" 
              value={statusFilter} 
              onChange={e => setStatusFilter(e.target.value)}
              style={{ 
                border: 'none', 
                boxShadow: 'none', 
                background: 'transparent', 
                fontSize: '1.05rem', 
                fontWeight: 600, 
                color: 'var(--text-primary)', 
                cursor: 'pointer', 
                padding: '4px 0',
                flex: 1,
                minWidth: 0
              }}
            >
              <option value="Active">Active Admissions</option>
              <option value="Discharged">Discharged</option>
              <option value="">All Admissions</option>
            </select>
          </div>

          {/* Discharge Summaries Hub Button */}
          <Link to="/ipd/discharge-summaries" className="btn btn-outline" style={{
            borderRadius: 40,
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontWeight: 700,
            border: '2.5px solid var(--blue)',
            color: 'var(--blue)',
            background: 'rgba(59, 130, 246, 0.05)'
          }}>
            <span style={{ fontSize: '1.3rem' }}>📄</span>
            Discharge Summaries Hub
          </Link>
        </div>

        {/* Results Container */}
        <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden' }}>
          {filteredAdmissions.length === 0 ? (
            <div className="hms-empty-state" style={{ margin: 24 }}>
              <span className="empty-icon">🛏️</span>
              <h3>No admissions found</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {searchQuery ? `We couldn't find any patient matching "${searchQuery}".` : 'There are no patients currently admitted matching this status.'}
              </p>
            </div>
          ) : (
            <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Admission ID</th>
                    <th>Patient Name</th>
                    <th>UHID</th>
                    <th>Diagnosis / Dept</th>
                    <th>Ward / Bed</th>
                    <th>Admitting Doctor</th>
                    <th>Admitted On</th>
                    <th>Days</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAdmissions.map(adm => (
                    <tr key={adm.ID || adm.id}>
                      <td><strong>{adm.ADMISSION_ID_FORMATTED || adm.admissionIdFormatted || '-'}</strong></td>
                      <td>{adm.PATIENT_NAME || adm.patientName}</td>
                      <td>{adm.UHID}</td>
                      <td>{adm.DEPARTMENT || '-'}</td>
                      <td>{adm.WARD_NAME ? `${adm.WARD_NAME} / ${adm.BED_NUMBER}` : '-'}</td>
                      <td>{adm.DOCTOR_NAME}</td>
                      <td>{new Date(adm.ADMISSION_DATE).toLocaleDateString()}</td>
                      <td>{adm.DAYS_ADMITTED} Days</td>
                      <td>
                        <span className={`badge ${adm.STATUS === 'Active' ? 'badge-primary' : 'badge-secondary'}`}>
                          {adm.STATUS}
                        </span>
                      </td>
                      <td>
                        <Link to={`/ipd/patient/${adm.ID || adm.id}`} className="btn btn-sm btn-outline" style={{ display: 'inline-block' }}>
                          View Chart
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
