import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';
import { useAuth } from '../../../context/AuthContext';
import { useSocket } from '../../../context/SocketContext';
import { openAuthenticatedBlob } from '../../../utils/authenticatedDownload';

export default function OPDBillingPage() {
  const { encounterId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const socket = useSocket();
  
  const [bill, setBill] = useState(null);
  const [patientId, setPatientId] = useState('');
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (!socket) return;
    socket.on('billing_updated', (data) => {
      console.log('💰 Billing updated:', data);
      if (data.patientId == patientId) {
        toast('Bill updated with new items!', { icon: '💰' });
        initBill();
      }
    });
    return () => {
      socket.off('billing_updated');
    };
  }, [socket, patientId]);

  const initBill = async () => {
    try {
      setLoading(true);
      const encRes = await api.get(`/hms/encounters/${encounterId}`);
      const pId = encRes.data.patient_id;
      setPatientId(pId);
      
      // Fetch Advance
      const advRes = await api.get(`/billing/advance/${pId}`);
      setAdvanceData(advRes.data.data);

      // Generate or fetch OPD bill
      const billRes = await api.post('/billing/opd', { encounterId, patientId: pId }).catch(err => {
         // If already generated, fetch it
         if(err.response?.status === 400) {
           return api.get(`/billing/patient/${pId}`);
         }
         throw err;
      });
      
      if (billRes && billRes.data.data) {
         const finalBillRes = await api.get(`/billing/${billRes.data.data.id || billRes.data.data.ID}`);
         setBill(finalBillRes.data.data);
         setPaymentForm(prev => ({ ...prev, amount: finalBillRes.data.data.NET_PAYABLE || finalBillRes.data.data.netPayable }));
      }
    } catch (err) {
       // Fallback logic...
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
      toast.error(err.response?.data?.message || 'Discount failed');
    }
  };

  const handlePayment = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post(`/billing/${bill.ID || bill.id}/payment`, {
        ...paymentForm,
        applyAdvance
      });
      toast.success('Payment recorded successfully');
      setReceipt(res.data.data);
      // Refresh bill
      const finalBillRes = await api.get(`/billing/${bill.ID || bill.id}`);
      setBill(finalBillRes.data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Payment failed');
    }
  };

  if (loading) return <div>Loading bill details...</div>;
  if (!bill) return <div>Error loading bill.</div>;

  if (receipt) {
    return (
      <>
      <Navbar />
      <div className="page-wrapper fade-up" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div className="card print-area" style={{ width: 600, padding: 40 }}>
           <div style={{ textAlign: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 24 }}>
             <h2>HMS Hospital</h2>
             <p>Payment Receipt</p>
           </div>
           <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
             <div>
               <strong>Receipt No:</strong> {receipt.RECEIPT_NUMBER || receipt.receiptNumber}<br/>
               <strong>Date:</strong> {new Date(receipt.PAYMENT_DATE || receipt.paymentDate).toLocaleString()}<br/>
               <strong>Patient:</strong> {bill.PATIENT_NAME} ({bill.UHID})
             </div>
             <div style={{ textAlign: 'right' }}>
               <strong>Bill No:</strong> {bill.BILL_NUMBER}<br/>
               <strong>Payment Mode:</strong> {receipt.PAYMENT_MODE || receipt.paymentMode}
             </div>
           </div>
           <div style={{ background: 'var(--surface-color)', padding: 16, borderRadius: 8, textAlign: 'center', marginBottom: 24 }}>
             <h1 style={{ margin: 0, color: 'var(--primary-color)' }}>₹{receipt.AMOUNT || receipt.amount}</h1>
             <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Amount Received successfully</p>
           </div>
           
           <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }} className="no-print">
             <button className="btn btn-primary" onClick={() => window.print()}>Print Receipt</button>
             <button className="btn btn-outline" onClick={() => navigate(`/billing/patient/${bill.PATIENT_ID}`)}>View History</button>
           </div>
        </div>
      </div>
      </>
    );
  }

  const isPaid = bill.STATUS === 'Paid';

  return (
    <>
    <Navbar />
    <div className="page-wrapper fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2>OPD Billing Checkout</h2>
        <span className="badge" style={{ background: isPaid ? '#48bb7820' : '#ecc94b20', color: isPaid ? '#48bb78' : '#d69e2e', padding: '8px 16px', fontSize: '1.2rem' }}>
          {bill.STATUS}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Bill Details */}
        <div className="card billing-invoice-print" style={{ flex: 2, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
             <div>
               <h4 style={{ margin: '0 0 8px 0' }}>Patient Info</h4>
               {bill.PATIENT_NAME} ({bill.UHID})<br/>
               {bill.AGE}Y / {bill.GENDER}<br/>
               Ph: {bill.PHONE}
             </div>
             <div style={{ textAlign: 'right' }}>
               <h4 style={{ margin: '0 0 8px 0' }}>Invoice</h4>
               <strong>{bill.BILL_NUMBER}</strong><br/>
               Date: {new Date(bill.CREATED_AT).toLocaleDateString()}
             </div>
          </div>

          <table className="table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginBottom: 24 }}>
            <thead>
              <tr style={{ background: 'var(--surface-color)' }}>
                <th style={{ padding: 12 }}>Service</th>
                <th style={{ padding: 12 }}>Qty</th>
                <th style={{ padding: 12 }}>Rate</th>
                <th style={{ padding: 12, textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.items && bill.items.map(item => (
                <tr key={item.ID} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 12 }}>
                    <strong>{item.ITEM_TYPE}</strong><br/>
                    <small style={{ color: 'var(--text-secondary)' }}>{item.ITEM_NAME}</small>
                  </td>
                  <td style={{ padding: 12 }}>{item.QUANTITY || 1}</td>
                  <td style={{ padding: 12 }}>₹{item.RATE}</td>
                  <td style={{ padding: 12, textAlign: 'right' }}>₹{item.AMOUNT}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ borderTop: '2px dashed var(--border)', paddingTop: 16 }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
               <span>Subtotal</span>
               <strong>₹{bill.TOTAL_AMOUNT}</strong>
             </div>
             <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
               <span>Discount</span>
               <strong style={{ color: 'var(--red)' }}>- ₹{bill.DISCOUNT_AMOUNT}</strong>
             </div>
             {bill.ADVANCE_ADJUSTED > 0 && (
               <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                 <span>Advance Adjusted</span>
                 <strong style={{ color: 'var(--blue)' }}>- ₹{bill.ADVANCE_ADJUSTED}</strong>
               </div>
             )}
             <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)', fontSize: '1.5rem' }}>
               <strong>Net Payable</strong>
               <strong>₹{bill.NET_PAYABLE}</strong>
             </div>
          </div>
        </div>

        {/* Payment & Actions */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
           
           {!isPaid && ['admin', 'super_admin'].includes(user.role) && (
             <div className="card" style={{ padding: 24 }}>
               <h4 style={{ marginBottom: 16 }}>Apply Discount</h4>
               <div style={{ display: 'flex', gap: 8 }}>
                 <input type="number" className="form-control" placeholder="Amount (₹)" value={discountAmount} onChange={e=>setDiscountAmount(e.target.value)} />
                 <button className="btn btn-secondary" onClick={handleApplyDiscount}>Apply</button>
               </div>
             </div>
           )}

           {!isPaid && (
             <div className="card" style={{ padding: 24, background: 'var(--surface-color)' }}>
               <h3 style={{ marginBottom: 16 }}>Record Payment</h3>
               
               {advanceData.availableAdvance > 0 && (
                 <div style={{ padding: 12, background: 'rgba(59,130,246,0.1)', border: '1px solid var(--blue)', borderRadius: 8, marginBottom: 16 }}>
                   <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, cursor: 'pointer', color: 'var(--blue)' }}>
                     <input type="checkbox" checked={applyAdvance} onChange={e=>setApplyAdvance(e.target.checked)} />
                     <strong>Use Patient Advance (Available: ₹{advanceData.availableAdvance})</strong>
                   </label>
                 </div>
               )}

               <form onSubmit={handlePayment} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                 <div className="form-group">
                   <label>Amount Recieved (₹)</label>
                   <input type="number" className="form-control" value={paymentForm.amount} onChange={e=>setPaymentForm({...paymentForm, amount: e.target.value})} required disabled={applyAdvance} />
                 </div>
                 {!applyAdvance && (
                   <>
                     <div className="form-group">
                       <label>Payment Mode</label>
                       <select className="form-control" value={paymentForm.paymentMode} onChange={e=>setPaymentForm({...paymentForm, paymentMode: e.target.value})}>
                         <option>Cash</option>
                         <option>Card</option>
                         <option>UPI</option>
                         <option>Cheque</option>
                       </select>
                     </div>
                     <div className="form-group">
                       <label>Reference No. (Optional)</label>
                       <input type="text" className="form-control" value={paymentForm.referenceNumber} onChange={e=>setPaymentForm({...paymentForm, referenceNumber: e.target.value})} />
                     </div>
                   </>
                 )}
                 <button type="submit" className="btn btn-primary" style={{ marginTop: 8 }}>Complete Transaction</button>
               </form>
             </div>
           )}

           {isPaid && (
             <div className="card" style={{ padding: 24, textAlign: 'center' }}>
               <div style={{ fontSize: '3rem', marginBottom: 16 }}>✅</div>
               <h3>Bill Fully Paid</h3>
               <button className="btn btn-outline" style={{ marginTop: 16, width: '100%' }} onClick={() => window.print()}>Print Invoice</button>
               <button type="button" onClick={() => openAuthenticatedBlob(`/pdf/bill/${bill.ID || bill.id}`, { download: true, filename: `bill-${bill.ID || bill.id}.pdf` })} className="btn btn-primary" style={{ marginTop: 8, width: '100%' }}>Download PDF</button>
             </div>
           )}
        </div>
      </div>
      
      <style jsx>{`
        @media print {
          .no-print { display: none !important; }
          .page-wrapper { margin: 0; padding: 0; }
          .card { border: none; box-shadow: none; }
        }
      `}</style>
    </div>
    </>
  );
}
