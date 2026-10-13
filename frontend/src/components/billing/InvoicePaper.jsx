// Printable invoice (Phase 5): the issued document, its corrections and what
// has been applied to it. Bed days are shown as one line per ward rate.
export const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function groupedLines(lines = []) {
  const out = [];
  for (const l of lines) {
    const ward = l.category === 'Ward';
    const key = ward ? `W:${l.code}:${Number(l.unit_price)}:${l.account_package_id || ''}` : l.id;
    let g = out.find((x) => x.key === key);
    if (!g) {
      g = { key, category: l.category, description: ward ? l.description.replace(/ bed day \d+$/, ' bed days') : l.description,
        quantity: 0, unitPrice: Number(l.unit_price), amount: 0, gst: 0, covered: Boolean(l.account_package_id) };
      out.push(g);
    }
    g.quantity += Number(l.quantity);
    g.amount += Number(l.amount);
    g.gst += Number(l.gst_amount);
  }
  return out;
}

export default function InvoicePaper({ invoice }) {
  if (!invoice) return null;
  const lines = groupedLines(invoice.lines);
  const credits = (invoice.notes || []).filter((n) => n.kind === 'credit');
  const debits = (invoice.notes || []).filter((n) => n.kind === 'debit');
  const fromDeposits = (invoice.allocations || []).filter((a) => a.fund_id).reduce((s, a) => s + Number(a.amount), 0);
  const payments = (invoice.allocations || []).filter((a) => a.receipt_id);
  const cell = { padding: '6px 8px', borderBottom: '1px solid #ddd' };
  const num = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  return (
    <div className="print-section bill-preview-paper" aria-label={`Invoice ${invoice.invoice_number || 'draft'}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>HMS HOSPITAL</h2>
          <div style={{ fontSize: 13 }}>{invoice.episode_type === 'admission' ? 'Inpatient' : 'Outpatient'} {invoice.kind === 'interim' ? 'interim ' : ''}invoice</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 13 }}>
          <div>Invoice <strong>{invoice.invoice_number || 'DRAFT'}</strong></div>
          <div>{fmt(invoice.issued_at || invoice.created_at)}</div>
          <div>Account {invoice.account_number}</div>
          {invoice.status === 'Void' && <div style={{ color: '#b00', fontWeight: 700 }}>VOID: {invoice.void_reason}</div>}
        </div>
      </div>
      <div style={{ fontSize: 14, marginBottom: 14 }}>
        Patient: <strong>{invoice.patient_name}</strong> · <span className="mono">{invoice.uhid}</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr><th style={cell}>Item</th><th style={num}>Qty</th><th style={num}>Rate</th><th style={num}>GST</th><th style={num}>Amount</th></tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key}>
              <td style={cell}>{l.description}{l.covered ? ' (in package)' : ''}</td>
              <td style={num}>{Number(l.quantity.toFixed(3))}</td>
              <td style={num}>{inr(l.unitPrice)}</td>
              <td style={num}>{inr(l.gst)}</td>
              <td style={num}>{inr(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginLeft: 'auto', maxWidth: 360, marginTop: 14, fontSize: 14 }}>
        {[
          ['Subtotal', invoice.subtotal],
          ['GST', invoice.gst_amount],
          Number(invoice.discount_amount) > 0 && [`Discount (${invoice.discount_reason})`, -Number(invoice.discount_amount)],
          ['Invoice total', invoice.total],
          Number(invoice.payer_amount) > 0 && ['Payer share', invoice.payer_amount],
          Number(invoice.payer_amount) > 0 && ['Patient share', invoice.patient_amount],
          ...credits.map((n) => [`Credit note ${n.note_number}`, -Number(n.amount)]),
          ...debits.map((n) => [`Debit note ${n.note_number}`, Number(n.amount)]),
          fromDeposits > 0 && ['Advance adjusted', -fromDeposits],
          ...payments.map((a) => [`Paid ${a.receipt_number} (${a.method})`, -Number(a.amount)]),
          ['Balance due', Math.max(0, Number(invoice.patient_due || 0))],
        ].filter(Boolean).map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontWeight: label === 'Balance due' || label === 'Invoice total' ? 700 : 400 }}>
            <span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{inr(value)}</span>
          </div>
        ))}
      </div>
      {credits.length + debits.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 12 }}>
          {[...credits, ...debits].map((n) => <div key={n.id}>{n.note_number}: {n.reason}</div>)}
        </div>
      )}
      <div style={{ marginTop: 40, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span>Issued by {invoice.issued_by_name || '—'}</span>
        <span>Authorised signatory</span>
      </div>
    </div>
  );
}
