import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import { openAuthenticatedBlob } from '../../../utils/authenticatedDownload';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';
import { useAuth } from '../../../context/AuthContext';
import { useSocket } from '../../../context/SocketContext';
import { ArrowLeft, CircleAlert, CircleCheck, Download, History, Printer, Receipt, RefreshCw, Wallet } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';

const STATUS_TONE = { Paid: 'success', 'Partially Paid': 'warning', Pending: 'warning', Cancelled: 'neutral' };

export default function OPDBillingPage() {
  const { encounterId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const socket = useSocket();
  
  const [bill, setBill] = useState(null);
  const [patientId, setPatientId] = useState('');
  const [loading, setLoading] = useState(true);
  const [advanceData, setAdvanceData] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', paymentMode: 'Cash', referenceNumber: '' });
  const [discountAmount, setDiscountAmount] = useState('');
  const [applyAdvance, setApplyAdvance] = useState(false);
  const [receipt, setReceipt] = useState(null);
  
  useEffect(() => {
    if (!socket) return;
    socket.on('billing_updated', (data) => {
      console.log('Billing updated:', data);
      if (data.patientId == patientId) {
        toast('Bill updated with new items');
        initBill();
      }
    });
    return () => {
      socket.off('billing_updated');
    };
  }, [socket, patientId]);

  const [loadError, setLoadError] = useState('');

  const initBill = async () => {
    try {
      setLoading(true);
      setLoadError('');
      // Creates the OPD bill, or returns the existing one if this visit was already billed
      const billRes = await api.post('/billing/opd', { encounterId });
      const created = billRes.data.data || {};
      const billId = created.id || created.ID;
      const pId = created.patientId || created.patient_id || created.PATIENT_ID;
      setPatientId(pId);

      const [finalBillRes, advRes] = await Promise.all([
        api.get(`/billing/${billId}`),
        pId ? api.get(`/billing/advance/${pId}`).catch(() => null) : Promise.resolve(null),
      ]);
      setAdvanceData(advRes?.data?.data);
      setBill(finalBillRes.data.data);
      setPaymentForm(prev => ({ ...prev, amount: finalBillRes.data.data.NET_PAYABLE || finalBillRes.data.data.netPayable }));
    } catch (err) {
      setLoadError(err.response?.data?.message || 'The bill could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (encounterId) initBill();
  }, [encounterId]);


  const handleApplyDiscount = async () => {
    if (!discountAmount || isNaN(discountAmount)) return;
    try {
      await api.post(`/billing/${bill.ID || bill.id}/discount`, { amount: Number(discountAmount) });
      toast.success('Discount applied');
      // Refresh bill
      const finalBillRes = await api.get(`/billing/${bill.ID || bill.id}`);
      setBill(finalBillRes.data.data);
      setPaymentForm(prev => ({ ...prev, amount: finalBillRes.data.data.NET_PAYABLE }));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not apply discount');
    }
  };

  const handlePayment = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post(`/billing/${bill.ID || bill.id}/payment`, {
        ...paymentForm,
        applyAdvance
      });
      toast.success('Payment recorded');
      setReceipt(res.data.data);
      // Refresh bill
      const finalBillRes = await api.get(`/billing/${bill.ID || bill.id}`);
      setBill(finalBillRes.data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not record payment');
    }
  };

  if (loading || !bill) {
    return (
      <>
        <Navbar />
        <main className="app-page">
          <section className="panel" style={{ maxWidth: 520, margin: '40px auto' }}>
            {loading ? (
              <p className="muted panel-pad" style={{ textAlign: 'center' }}>Loading bill details…</p>
            ) : (
              <EmptyState
                icon={CircleAlert}
                title="Bill unavailable"
                description={loadError || 'The bill could not be loaded.'}
                action={(
                  <>
                    <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate(-1)}>
                      <ArrowLeft size={16} aria-hidden="true" /> Go back
                    </button>
                    <button type="button" className="btn btn-primary btn-md" onClick={initBill}>
                      <RefreshCw size={16} aria-hidden="true" /> Try again
                    </button>
                  </>
                )}
              />
            )}
          </section>
        </main>
      </>
    );
  }

  if (receipt) {
    return (
      <>
      <Navbar />
      <main className="app-page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <section className="panel print-area" style={{ width: '100%', maxWidth: 600, padding: 32 }}>
           <div style={{ textAlign: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 20 }}>
             <h2 style={{ fontSize: '1.2rem', fontWeight: 650 }}>HMS Hospital</h2>
             <p className="muted">Payment receipt</p>
           </div>
           <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
             <div className="stack-sm" style={{ gap: 4 }}>
               <div><span className="fact-label">Receipt no.</span> <span className="mono">{receipt.RECEIPT_NUMBER || receipt.receiptNumber}</span></div>
               <div><span className="fact-label">Date</span> <span className="tabular">{new Date(receipt.PAYMENT_DATE || receipt.paymentDate).toLocaleString()}</span></div>
               <div><span className="fact-label">Patient</span> {bill.PATIENT_NAME} (<span className="mono">{bill.UHID}</span>)</div>
             </div>
             <div className="stack-sm" style={{ gap: 4, textAlign: 'right' }}>
               <div><span className="fact-label">Bill no.</span> <span className="mono">{bill.BILL_NUMBER}</span></div>
               <div><span className="fact-label">Payment mode</span> {receipt.PAYMENT_MODE || receipt.paymentMode}</div>
             </div>
           </div>
           <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', padding: 16, borderRadius: 8, textAlign: 'center', marginBottom: 20 }}>
             <div className="tabular" style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--primary)' }}>₹{receipt.AMOUNT || receipt.amount}</div>
             <p className="muted">Amount received</p>
           </div>
           
           <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }} className="no-print">
             <button type="button" className="btn btn-primary btn-md" onClick={() => window.print()}>
               <Printer size={16} aria-hidden="true" /> Print receipt
             </button>
             <button type="button" className="btn btn-secondary btn-md" onClick={() => navigate(`/billing/patient/${bill.PATIENT_ID}`)}>
               <History size={16} aria-hidden="true" /> View history
             </button>
           </div>
        </section>
      </main>
      </>
    );
  }

  const isPaid = bill.STATUS === 'Paid';
  const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 };

  return (
    <>
    <Navbar />
    <main className="app-page">
      <PageHeader
        title="OPD billing"
        description="Review the charges for this visit, apply a discount if needed and record payment."
        meta={<span className={`status status-${STATUS_TONE[bill.STATUS] || 'info'}`}>{bill.STATUS}</span>}
      />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Bill Details */}
        <section className="panel panel-pad billing-invoice-print" style={{ flex: '2 1 520px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
             <div>
               <div className="fact-label" style={{ marginBottom: 4 }}>Patient</div>
               <div className="cell-primary">{bill.PATIENT_NAME} (<span className="mono">{bill.UHID}</span>)</div>
               <div className="cell-secondary">{bill.AGE}Y / {bill.GENDER}</div>
               <div className="cell-secondary">Ph: {bill.PHONE}</div>
             </div>
             <div style={{ textAlign: 'right' }}>
               <div className="fact-label" style={{ marginBottom: 4 }}>Invoice</div>
               <div className="mono" style={{ fontWeight: 600 }}>{bill.BILL_NUMBER}</div>
               <div className="cell-secondary">Date: {new Date(bill.CREATED_AT).toLocaleDateString()}</div>
             </div>
          </div>

          <table className="mini-table" style={{ marginBottom: 20 }}>
            <thead>
              <tr>
                <th>Service</th>
                <th>Qty</th>
                <th>Rate</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.items && bill.items.map(item => (
                <tr key={item.ID}>
                  <td>
                    <span className="cell-stack">
                      <span className="cell-primary">{item.ITEM_TYPE}</span>
                      <span className="cell-secondary">{item.ITEM_NAME}</span>
                    </span>
                  </td>
                  <td className="tabular">{item.QUANTITY || 1}</td>
                  <td className="tabular">₹{item.RATE}</td>
                  <td className="tabular" style={{ textAlign: 'right' }}>₹{item.AMOUNT}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="tabular" style={{ borderTop: '1px dashed var(--border)', paddingTop: 14 }}>
             <div style={rowStyle}>
               <span style={{ color: 'var(--text-secondary)' }}>Subtotal</span>
               <strong>₹{bill.TOTAL_AMOUNT}</strong>
             </div>
             <div style={rowStyle}>
               <span style={{ color: 'var(--text-secondary)' }}>Discount</span>
               <strong style={{ color: 'var(--red)' }}>- ₹{bill.DISCOUNT_AMOUNT}</strong>
             </div>
             {bill.ADVANCE_ADJUSTED > 0 && (
               <div style={rowStyle}>
                 <span style={{ color: 'var(--text-secondary)' }}>Advance adjusted</span>
                 <strong style={{ color: 'var(--primary)' }}>- ₹{bill.ADVANCE_ADJUSTED}</strong>
               </div>
             )}
             <div style={{ ...rowStyle, marginTop: 12, paddingTop: 12, marginBottom: 0, borderTop: '1px solid var(--border)', fontSize: '1.35rem' }}>
               <strong>Net payable</strong>
               <strong>₹{bill.NET_PAYABLE}</strong>
             </div>
          </div>
        </section>

        {/* Payment & Actions */}
        <div className="stack" style={{ flex: '1 1 300px' }}>
           
           {!isPaid && ['admin', 'super_admin'].includes(user.role) && (
             <section className="panel panel-pad no-print">
               <h2 className="panel-title">Apply discount</h2>
               <label className="sr-only" htmlFor="discount-amount">Discount amount (₹)</label>
               <div style={{ display: 'flex', gap: 8 }}>
                 <input id="discount-amount" type="number" className="form-input" placeholder="Amount (₹)" value={discountAmount} onChange={e=>setDiscountAmount(e.target.value)} />
                 <button type="button" className="btn btn-secondary btn-md" onClick={handleApplyDiscount}>Apply</button>
               </div>
             </section>
           )}

           {!isPaid && (
             <section className="panel panel-pad no-print">
               <h2 className="panel-title"><Wallet size={16} aria-hidden="true" /> Record payment</h2>
               
               {advanceData?.availableAdvance > 0 && (
                 <div className="alert-strip alert-info">
                   <label className="check-row" style={{ margin: 0 }}>
                     <input type="checkbox" checked={applyAdvance} onChange={e=>setApplyAdvance(e.target.checked)} />
                     <strong>Use patient advance (available: ₹{advanceData.availableAdvance})</strong>
                   </label>
                 </div>
               )}

               <form onSubmit={handlePayment} className="stack-sm">
                 <div className="form-group">
                   <label className="form-label" htmlFor="pay-amount">Amount received (₹)</label>
                   <input id="pay-amount" type="number" className="form-input" value={paymentForm.amount} onChange={e=>setPaymentForm({...paymentForm, amount: e.target.value})} required disabled={applyAdvance} />
                 </div>
                 {!applyAdvance && (
                   <>
                     <div className="form-group">
                       <label className="form-label" htmlFor="pay-mode">Payment mode</label>
                       <select id="pay-mode" className="form-select" value={paymentForm.paymentMode} onChange={e=>setPaymentForm({...paymentForm, paymentMode: e.target.value})}>
                         <option>Cash</option>
                         <option>Card</option>
                         <option>UPI</option>
                         <option>Cheque</option>
                       </select>
                     </div>
                     <div className="form-group">
                       <label className="form-label" htmlFor="pay-ref">Reference no. (optional)</label>
                       <input id="pay-ref" type="text" className="form-input" value={paymentForm.referenceNumber} onChange={e=>setPaymentForm({...paymentForm, referenceNumber: e.target.value})} />
                     </div>
                   </>
                 )}
                 <button type="submit" className="btn btn-primary btn-md" style={{ marginTop: 4 }}>
                   <Receipt size={16} aria-hidden="true" /> Complete payment
                 </button>
               </form>
             </section>
           )}

           {isPaid && (
             <section className="panel panel-pad no-print" style={{ textAlign: 'center' }}>
               <CircleCheck size={32} aria-hidden="true" style={{ color: 'var(--success)', marginBottom: 8 }} />
               <h2 className="panel-title" style={{ justifyContent: 'center' }}>Bill fully paid</h2>
               <div className="stack-sm">
                 <button type="button" className="btn btn-secondary btn-md" style={{ width: '100%', justifyContent: 'center' }} onClick={() => window.print()}>
                   <Printer size={16} aria-hidden="true" /> Print invoice
                 </button>
                 <button type="button" className="btn btn-primary btn-md" style={{ width: '100%', justifyContent: 'center' }} onClick={() => openAuthenticatedBlob(`/pdf/bill/${bill.ID || bill.id}`, { download: true, filename: `bill-${bill.ID || bill.id}.pdf` })}>
                   <Download size={16} aria-hidden="true" /> Download PDF
                 </button>
               </div>
             </section>
           )}
        </div>
      </div>
      
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .app-page { margin: 0; padding: 0; }
          .panel { border: none; box-shadow: none; }
        }
      `}</style>
    </main>
    </>
  );
}
