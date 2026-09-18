import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import api from '../../../api/axios';
import { openAuthenticatedBlob } from '../../../utils/authenticatedDownload';

export default function PrescriptionPreviewPage() {
  const { id } = useParams(); // Prescription ID
  const [prescription, setPrescription] = useState(null);
  const [hosp, setHosp] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPrescription();
  }, [id]);

  const fetchPrescription = async () => {
    try {
      const pRes = await api.get(`/hms/prescriptions/${id}`);
      const prescriptionData = pRes.data?.data || null;

      if (!prescriptionData) {
        throw new Error('Prescription data not found');
      }

      setPrescription(prescriptionData);

      const hRes = await api.get('/admin/hospital-profile').catch(() => ({ data: { data: {} } }));
      setHosp(hRes.data.data || {});
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading Prescription...</div>;
  if (!prescription) return <div style={{ padding: 40, textAlign: 'center' }}>Prescription data not found.</div>;

  const patient = prescription.patient || {};
  const doctor = prescription.doctor || {};
  const encounter = prescription.encounter || {};
  const handlePrint = () => {
    window.requestAnimationFrame(() => {
      window.print();
    });
  };

  return (
    <div className="prescription-preview-page" style={{ background: '#fff', minHeight: '100vh', padding: '40px 0', fontFamily: 'Arial, sans-serif', color: '#000' }}>
      
      <div className="prescription-preview-sheet" style={{ maxWidth: 800, margin: '0 auto', border: '1px solid #ccc', padding: 40, position: 'relative', color: '#000', background: '#fff' }}>
        
        {/* Buttons (Hidden on Print) */}
        <div className="no-print" style={{ position: 'absolute', top: -50, right: 0, display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={handlePrint}>Print Prescription</button>
          {prescription?.id && (
            <button
              type="button"
              onClick={() => openAuthenticatedBlob(`/pdf/prescription/${prescription.id}`, { download: true, filename: `prescription-${prescription.id}.pdf` })}
              className="btn btn-outline"
            >
              Download PDF
            </button>
          )}
          <button className="btn btn-outline" onClick={() => window.close()}>Close</button>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #0f4c81', paddingBottom: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 15, alignItems: 'center' }}>
            <img src="/logo.png" alt="Logo" style={{ width: 60 }} />
            <div>
              <h1 style={{ margin: 0, color: '#000', fontSize: '24px' }}>{hosp.NAME || 'HOSPITAL MANAGEMENT SYSTEM'}</h1>
              <p style={{ margin: '5px 0 0 0', fontWeight: 'bold', color: '#000' }}>{hosp.TAGLINE || 'HEALTHCARE EXCELLENCE CENTER'}</p>
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: '12px', color: '#000' }}>
            <p>Ph: {hosp.PHONE || '01887-220000'}</p>
            <p>{hosp.EMAIL || 'hospital@hms.com'}</p>
          </div>
        </div>

        {/* Doctor Details */}
        <div style={{ marginBottom: 20, fontSize: '14px', color: '#000' }}>
          <strong>Dr. {doctor?.name}</strong> <br />
          <span style={{ color: '#000' }}>{doctor?.role ? doctor.role.replace('_', ' ').toUpperCase() : 'DOCTOR'}</span>
        </div>

        <div style={{ borderTop: '1px solid #ddd', borderBottom: '1px solid #ddd', padding: '10px 0', display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: 20, color: '#000' }}>
          <div>
            <strong>Patient Name:</strong> {patient?.name} <br />
            <strong>Age/Sex:</strong> {patient?.age} / {patient?.gender}
          </div>
          <div style={{ textAlign: 'right' }}>
            <strong>UHID:</strong> {patient?.uhid || patient?.id} <br />
            <strong>Date:</strong> {new Date(prescription.created_at || prescription.createdAt || Date.now()).toLocaleDateString('en-IN')}
          </div>
        </div>

        {/* Clinical Info */}
        {(encounter.chief_complaint || encounter.diagnoses?.length > 0) && (
          <div style={{ marginBottom: 30, fontSize: '13px', color: '#000' }}>
            {encounter.chief_complaint && (
              <p><strong>C/O:</strong> {encounter.chief_complaint}</p>
            )}
            {encounter.diagnoses?.length > 0 && (
              <p>
                <strong>Diagnosis:</strong>{' '}
                {encounter.diagnoses.map(d => d.icd10_description).join(', ')}
              </p>
            )}
          </div>
        )}

        {/* RX Symbol */}
        <div style={{ fontSize: '32px', fontWeight: 'bold', fontFamily: 'serif', marginBottom: 15 }}>
          Rx
        </div>

        {/* Meds Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: 40, color: '#000' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
              <th style={{ padding: 8, borderBottom: '1px solid #ddd' }}>S.No</th>
              <th style={{ padding: 8, borderBottom: '1px solid #ddd' }}>Medicine</th>
              <th style={{ padding: 8, borderBottom: '1px solid #ddd' }}>Dose</th>
              <th style={{ padding: 8, borderBottom: '1px solid #ddd' }}>Route</th>
              <th style={{ padding: 8, borderBottom: '1px solid #ddd' }}>Frequency</th>
              <th style={{ padding: 8, borderBottom: '1px solid #ddd' }}>Duration</th>
              <th style={{ padding: 8, borderBottom: '1px solid #ddd' }}>Instructions</th>
            </tr>
          </thead>
          <tbody>
            {prescription.items?.map((item, idx) => (
              <tr key={idx}>
                <td style={{ padding: 8, borderBottom: '1px dashed #eee' }}>{idx + 1}</td>
                <td style={{ padding: 8, borderBottom: '1px dashed #eee', fontWeight: 'bold' }}>{item.medicine_name}</td>
                <td style={{ padding: 8, borderBottom: '1px dashed #eee' }}>{item.dose} {item.dose_unit}</td>
                <td style={{ padding: 8, borderBottom: '1px dashed #eee' }}>{item.route}</td>
                <td style={{ padding: 8, borderBottom: '1px dashed #eee' }}>{item.frequency}</td>
                <td style={{ padding: 8, borderBottom: '1px dashed #eee' }}>{item.duration_days} Days</td>
                <td style={{ padding: 8, borderBottom: '1px dashed #eee' }}>{item.instructions}</td>
              </tr>
            ))}
            {(!prescription.items || prescription.items.length === 0) && (
              <tr>
                <td colSpan="7" style={{ padding: 20, textAlign: 'center', color: '#000' }}>No medicines prescribed.</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Footer info (QR & Sign) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 60 }}>
          <div>
            {prescription.qr_data ? (
              <div style={{ border: '1px solid #ddd', padding: 10, display: 'inline-block' }}>
                <QRCodeSVG value={prescription.qr_data} size={100} />
                <div style={{ fontSize: '10px', textAlign: 'center', marginTop: 5, color: '#000' }}>Scan at Pharmacy</div>
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: '#000', fontStyle: 'italic' }}>
                * QR code will generate upon finalization
              </div>
            )}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 150, borderBottom: '1px solid #000', marginBottom: 5 }}></div>
            <div style={{ fontSize: '13px' }}><strong>Dr. {doctor?.name}</strong></div>
            <div style={{ fontSize: '11px', color: '#000' }}>Signature / Stamp</div>
          </div>
        </div>

      </div>

      <style>{`
        .prescription-preview-page,
        .prescription-preview-page * {
          color: #000 !important;
        }
        @media print {
          @page {
            size: A4;
            margin: 12mm;
          }
          html, body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body * {
            visibility: hidden;
          }
          .prescription-preview-sheet,
          .prescription-preview-sheet * {
            visibility: visible;
          }
          .prescription-preview-page {
            padding: 0 !important;
            min-height: auto !important;
            background: #fff !important;
          }
          .prescription-preview-sheet {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
