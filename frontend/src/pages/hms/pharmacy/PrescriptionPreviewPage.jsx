import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Download, FileText, Printer, X } from 'lucide-react';
import api from '../../../api/axios';
import EmptyState from '../../../components/ui/EmptyState';
import { openAuthenticatedBlob } from '../../../utils/authenticatedDownload';
import { PRINT_LANGUAGES, explainFrequency } from '../../../print/printLanguages';

const PRINT_FONTS = "Arial, 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Gujarati', 'Noto Sans Bengali', 'Noto Sans Gurmukhi', 'Noto Sans Oriya', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Kannada', 'Noto Sans Malayalam', 'Nirmala UI', Mangal, sans-serif";

export default function PrescriptionPreviewPage() {
  const { id } = useParams(); // Prescription ID
  const [prescription, setPrescription] = useState(null);
  const [hosp, setHosp] = useState({});
  const [loading, setLoading] = useState(true);
  // A second language printed beside English for the patient (C2); remembered on this computer.
  const [printLang, setPrintLang] = useState(() => { try { return localStorage.getItem('hms.printLang') || ''; } catch { return ''; } });
  const L2 = PRINT_LANGUAGES[printLang];
  const chooseLang = (v) => { setPrintLang(v); try { localStorage.setItem('hms.printLang', v); } catch { /* convenience only */ } };
  const bi = (key, english) => (L2 ? <>{english}<span lang={L2.lang} className="slip-l2"> / {L2.labels[key]}</span></> : english);

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

  if (loading) return <main className="app-page"><p className="muted">Loading prescription…</p></main>;
  if (!prescription) {
    return (
      <main className="app-page">
        <section className="panel">
          <EmptyState icon={FileText} title="Prescription not found" description="It may have been removed, or the link is incomplete." />
        </section>
      </main>
    );
  }

  const patient = prescription.patient || {};
  const doctor = prescription.doctor || {};
  const encounter = prescription.encounter || {};
  const handlePrint = () => {
    window.requestAnimationFrame(() => {
      window.print();
    });
  };

  return (
    <main>
    {/* Screen toolbar (hidden on print). Kept outside the sheet so the sheet's forced print colours do not apply to it. */}
    <div className="no-print" style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span className="toolbar-caption"><FileText size={16} aria-hidden="true" /> Prescription preview</span>
        <div className="inline-actions">
          <label className="form-label" htmlFor="rx-lang" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
            Second language
            <select id="rx-lang" className="form-select" style={{ width: 'auto' }} value={printLang} onChange={(e) => chooseLang(e.target.value)}>
              <option value="">None (English only)</option>
              {Object.entries(PRINT_LANGUAGES).map(([k, l]) => <option key={k} value={k}>{l.name}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => window.close()}>
            <X size={16} aria-hidden="true" /> Close
          </button>
          {prescription?.id && (
            <button
              type="button"
              className="btn btn-secondary btn-md"
              onClick={() => openAuthenticatedBlob(`/pdf/prescription/${prescription.id}`, { download: true, filename: `prescription-${prescription.id}.pdf` })}
            >
              <Download size={16} aria-hidden="true" /> Download PDF
            </button>
          )}
          <button type="button" className="btn btn-primary btn-md" onClick={handlePrint}>
            <Printer size={16} aria-hidden="true" /> Print prescription
          </button>
        </div>
      </div>
      {L2 && !L2.reviewed && <p className="alert-strip alert-warning" role="status" style={{ maxWidth: 800, margin: '0 auto 8px' }}>The {L2.name} wording has not yet had the hospital's language review. English on the prescription remains the reference.</p>}
    </div>

    <div className="prescription-preview-page" style={{ background: '#fff', minHeight: '100vh', padding: '40px 0', fontFamily: PRINT_FONTS, color: '#000' }}>
      
      <div className="prescription-preview-sheet" style={{ maxWidth: 800, margin: '0 auto', border: '1px solid #ccc', padding: 40, position: 'relative', color: '#000', background: '#fff' }}>
        <p role="note" style={{border:'1px solid #555',padding:8}}>Historical prescription record. Review signed coded medication orders before dispensing or administering medicines.</p>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #0f4c81', paddingBottom: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 15, alignItems: 'center' }}>
            <img src="/logo.png" alt="Logo" style={{ width: 60 }} />
            <div>
              <h1 style={{ margin: 0, color: '#000', fontSize: '24px' }}>{hosp.NAME || 'HMS HOSPITAL'}</h1>
              <p style={{ margin: '5px 0 0 0', fontWeight: 'bold', color: '#000' }}>{hosp.TAGLINE || 'CENTRAL CLINICAL CARE'}</p>
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: '12px', color: '#000' }}>
            <p>Ph: {hosp.PHONE || '01887-220000'}</p>
            <p>{hosp.EMAIL || 'info@hospital.org'}</p>
          </div>
        </div>

        {/* Doctor Details */}
        <div style={{ marginBottom: 20, fontSize: '14px', color: '#000' }}>
          <strong>Dr. {(doctor?.name || 'Doctor').replace(/^Dr\.?\s*/i, '')}</strong> <br />
          <span style={{ color: '#000' }}>{doctor?.role ? doctor.role.replace('_', ' ').toUpperCase() : 'DOCTOR'}</span>
        </div>

        <div style={{ borderTop: '1px solid #ddd', borderBottom: '1px solid #ddd', padding: '10px 0', display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: 20, color: '#000' }}>
          <div>
            <strong>{bi('patientName', 'Patient Name')}:</strong> {patient?.name} <br />
            <strong>{bi('ageGender', 'Age/Sex')}:</strong> {patient?.age} / {patient?.gender}
          </div>
          <div style={{ textAlign: 'right' }}>
            <strong>UHID:</strong> {patient?.uhid || patient?.id} <br />
            <strong>{bi('date', 'Date')}:</strong> {new Date(prescription.created_at || prescription.createdAt || Date.now()).toLocaleDateString('en-IN')}
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
              <th style={{ padding: 8, borderBottom: '1px solid #ddd' }}>{bi('medicine', 'Medicine')}</th>
              <th style={{ padding: 8, borderBottom: '1px solid #ddd' }}>{bi('dose', 'Dose')}</th>
              <th style={{ padding: 8, borderBottom: '1px solid #ddd' }}>{bi('route', 'Route')}</th>
              <th style={{ padding: 8, borderBottom: '1px solid #ddd' }}>{bi('frequency', 'Frequency')}</th>
              <th style={{ padding: 8, borderBottom: '1px solid #ddd' }}>{bi('days', 'Duration')}</th>
              <th style={{ padding: 8, borderBottom: '1px solid #ddd' }}>{bi('instructions', 'Instructions')}</th>
            </tr>
          </thead>
          <tbody>
            {prescription.items?.map((item, idx) => (
              <tr key={idx}>
                <td style={{ padding: 8, borderBottom: '1px dashed #eee' }}>{idx + 1}</td>
                <td style={{ padding: 8, borderBottom: '1px dashed #eee', fontWeight: 'bold' }}>{item.medicine_name}</td>
                <td style={{ padding: 8, borderBottom: '1px dashed #eee' }}>{item.dose} {item.dose_unit}</td>
                <td style={{ padding: 8, borderBottom: '1px dashed #eee' }}>{item.route}</td>
                <td style={{ padding: 8, borderBottom: '1px dashed #eee' }}>{item.frequency}{L2 && explainFrequency(item.frequency, printLang) && <div lang={L2.lang} className="slip-l2">{explainFrequency(item.frequency, printLang)}</div>}</td>
                <td style={{ padding: 8, borderBottom: '1px dashed #eee' }}>{item.duration_days} Days{L2 && item.duration_days && <div lang={L2.lang} className="slip-l2">{L2.days(item.duration_days)}</div>}</td>
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
            <div style={{ fontSize: '13px' }}><strong>Dr. {(doctor?.name || 'Doctor').replace(/^Dr\.?\s*/i, '')}</strong></div>
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
    </main>
  );
}
