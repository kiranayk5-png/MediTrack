import { useEffect, useState } from 'react';
import { ArrowLeftRight, Check, CircleAlert, Package, RefreshCw, Send, ShieldCheck, X } from 'lucide-react';
import { api, json } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, Field, Modal, PageHeader, StatusPill, TableSkeleton } from '../components/UI';

const actionsFor = (transfer, user) => {
  const admin = user?.role === 'platform_admin';
  const source = admin || Number(user?.pharmacyId) === Number(transfer.sourcePharmacyId);
  const destination = admin || Number(user?.pharmacyId) === Number(transfer.destinationPharmacyId);
  return { source, destination };
};

export default function TransfersPage() {
  const { user } = useAuth(); const toast = useToast();
  const [rows, setRows] = useState([]); const [pharmacies, setPharmacies] = useState([]); const [inventory, setInventory] = useState([]);
  const [sourceId, setSourceId] = useState(user?.pharmacyId ? String(user.pharmacyId) : ''); const [destinationId, setDestinationId] = useState('');
  const [batchId, setBatchId] = useState(''); const [quantity, setQuantity] = useState('1');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const [rejectingTransfer, setRejectingTransfer] = useState(null);
  const isAdmin = user?.role === 'platform_admin';

  async function load() {
    setLoading(true); setError(null);
    try {
      const [transferResult, pharmacyResult] = await Promise.all([api('/transfers'), api(isAdmin ? '/pharmacies' : '/pharmacies/destinations')]);
      setRows(transferResult.data); setPharmacies(pharmacyResult.data);
      if (!isAdmin && user?.pharmacyId) setSourceId(String(user.pharmacyId));
    } catch (e) { setError(e); } finally { setLoading(false); }
  }
  async function loadSourceStock(pharmacy = sourceId) {
    if (!pharmacy) { setInventory([]); return; }
    try { setInventory((await api(`/inventory?pharmacyId=${encodeURIComponent(pharmacy)}&limit=100`)).data); }
    catch (e) { toast(e.message, 'error'); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { loadSourceStock(); }, [sourceId]);

  async function createTransfer(event) {
    event.preventDefault(); setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = { destinationPharmacyId: Number(form.get('destinationPharmacyId')), batchId: Number(form.get('batchId')), quantity: Number(form.get('quantity')), notes: form.get('notes') || null };
    if (isAdmin) body.sourcePharmacyId = Number(form.get('sourcePharmacyId'));
    try {
      await api('/transfers', json('POST', body)); toast('Transfer request recorded. Stock is rechecked at dispatch.');
      setBatchId(''); setQuantity('1'); setDestinationId(''); formElement.reset(); await load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  async function transition(transfer, action) {
    let body;
    if (action === 'reject') return;
    setBusy(true);
    try { await api(`/transfers/${transfer.id}/${action}`, json('POST', body || {})); toast(`Transfer ${action.replaceAll('_', ' ')} completed.`); await load(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  async function submitRejection(event) {
    event.preventDefault();
    if (!rejectingTransfer) return;
    const reason = String(new FormData(event.currentTarget).get('reason') || '').trim();
    if (reason.length < 3) return;
    setBusy(true);
    try { await api(`/transfers/${rejectingTransfer.id}/reject`, json('POST', { reason })); toast('Transfer rejected.'); setRejectingTransfer(null); await load(); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  return <>
    <PageHeader eyebrow="NETWORK OPERATIONS" title="Stock transfers" description="Request, dispatch, receive, or return batches between pharmacies with a full movement trail." action={<button className="button button-secondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>} />
    <section className="panel workflow-panel transfer-request"><div className="table-toolbar"><div><h2><ArrowLeftRight size={17} /> New transfer request</h2><p>Source stock is checked now and locked again when dispatched.</p></div><StatusPill tone="neutral">Transaction tracked</StatusPill></div>
      <form className="form-stack workflow-form" onSubmit={createTransfer}><div className="form-grid">
        <Field label="Source pharmacy">{isAdmin ? <select name="sourcePharmacyId" required value={sourceId} onChange={(e) => setSourceId(e.target.value)}><option value="">Choose source</option>{pharmacies.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select> : <input value={pharmacies.find((p) => Number(p.id) === Number(sourceId))?.name || `Pharmacy ${sourceId || ''}`} readOnly aria-readonly="true" />}</Field>
        <Field label="Destination pharmacy"><select name="destinationPharmacyId" required value={destinationId} onChange={(e) => setDestinationId(e.target.value)}><option value="">Choose destination</option>{pharmacies.filter((p) => Number(p.id) !== Number(sourceId)).map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Source batch"><select name="batchId" required value={batchId} onChange={(e) => setBatchId(e.target.value)}><option value="">Choose batch</option>{inventory.filter((row) => Number(row.quantityOnHand) > 0 && !row.isRecalled).map((row) => <option value={row.batchId} key={row.batchId}>{row.medicineName} · {row.batchNumber} · {row.quantityOnHand} on hand</option>)}</select></Field>
        <Field label="Units to transfer"><input name="quantity" type="number" min="1" step="1" max="100000" required value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
        <Field label="Transfer notes"><input name="notes" maxLength="1000" placeholder="Optional handling or dispatch notes" /></Field>
      </div><div className="form-note"><ShieldCheck size={14} /> Shipment locks and deducts source stock. Receipt creates or matches a destination lot and records both stock movements. Expired and recalled batches cannot ship.</div><div className="workflow-actions"><button className="button button-primary" disabled={busy || !sourceId || !destinationId || !batchId}><ArrowLeftRight size={15} /> {busy ? 'Saving…' : 'Request transfer'}</button></div></form>
    </section>
    <section className="panel table-panel module-table transfer-register"><div className="table-toolbar"><div><h2>Transfer register</h2><p>Visible transfers involving your pharmacy scope</p></div><span className="record-count">{rows.length} records</span></div>
      {loading ? <TableSkeleton rows={5} cols={6} /> : error ? <ErrorState error={error} retry={load} /> : rows.length ? <>
        <div className="data-table-wrap transfer-desktop-table"><table className="data-table transfer-table"><thead><tr><th>MEDICINE / LOT</th><th>ROUTE</th><th>UNITS</th><th>REQUESTED</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{rows.map((transfer) => { const access = actionsFor(transfer, user); return <tr key={transfer.id}><td><div className="stacked-cell"><b>{transfer.medicineName}</b><small>{transfer.batchNumber} · expires {new Date(transfer.expiryDate).toLocaleDateString('en-IN')}</small></div></td><td><div className="transfer-route"><span>{transfer.sourcePharmacy}</span><ArrowLeftRight size={13} aria-hidden="true" /><span>{transfer.destinationPharmacy}</span></div></td><td>{transfer.quantity}</td><td>{new Date(transfer.requestedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td><td><StatusPill tone={transfer.status === 'received' ? 'good' : ['rejected','cancelled'].includes(transfer.status) ? 'danger' : 'warning'}>{transfer.status.replaceAll('_', ' ')}</StatusPill><TransferTimeline status={transfer.status} /></td><td><TransferActions access={access} transfer={transfer} busy={busy} transition={transition} onReject={setRejectingTransfer} /></td></tr>; })}</tbody></table></div>
        <div className="transfer-mobile-list" aria-label="Stock transfer cards">{rows.map((transfer) => { const access = actionsFor(transfer, user); return <article className="transfer-mobile-card" key={`mobile-${transfer.id}`}>
          <div className="transfer-mobile-heading"><div className="stacked-cell"><b>{transfer.medicineName}</b><small>{transfer.batchNumber} · expires {new Date(transfer.expiryDate).toLocaleDateString('en-IN')}</small></div><StatusPill tone={transfer.status === 'received' ? 'good' : ['rejected','cancelled'].includes(transfer.status) ? 'danger' : 'warning'}>{transfer.status.replaceAll('_', ' ')}</StatusPill></div>
          <div className="transfer-mobile-route"><div><small>FROM</small><b>{transfer.sourcePharmacy}</b></div><ArrowLeftRight size={16} aria-hidden="true" /><div><small>TO</small><b>{transfer.destinationPharmacy}</b></div></div>
          <div className="transfer-mobile-meta"><span><small>Quantity</small><b>{transfer.quantity} units</b></span><span><small>Requested</small><b>{new Date(transfer.requestedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</b></span></div>
          <TransferTimeline status={transfer.status} />
          <TransferActions access={access} transfer={transfer} busy={busy} transition={transition} onReject={setRejectingTransfer} />
        </article>; })}</div>
      </> : <EmptyState icon={CircleAlert} title="No transfers recorded" text="Transfer requests and their dispatch/receipt history will appear here." />}
    </section>
    {rejectingTransfer && <Modal title={`Reject transfer · ${rejectingTransfer.medicineName}`} onClose={() => setRejectingTransfer(null)}><form className="form-stack" onSubmit={submitRejection}><p className="transfer-reject-context">{rejectingTransfer.quantity} units · {rejectingTransfer.sourcePharmacy} to {rejectingTransfer.destinationPharmacy}</p><Field label="Reason for rejection"><textarea name="reason" required minLength="3" maxLength="1000" rows="4" placeholder="Explain why this request cannot proceed" /></Field><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setRejectingTransfer(null)}>Keep request</button><button className="button button-danger" disabled={busy}>{busy ? 'Rejecting…' : 'Reject transfer'}</button></div></form></Modal>}
  </>;
}

function TransferActions({ access, transfer, busy, transition, onReject }) {
  return <div className="table-actions transfer-actions">{access.source && transfer.status === 'requested' && <button type="button" className="button button-small button-secondary" disabled={busy} onClick={() => transition(transfer, 'approve')}><Check size={13} /> Approve</button>}{access.source && transfer.status === 'approved' && <button type="button" className="button button-small button-primary" disabled={busy} onClick={() => transition(transfer, 'ship')}><Send size={13} /> Dispatch</button>}{access.destination && transfer.status === 'in_transit' && <button type="button" className="button button-small button-primary" disabled={busy} onClick={() => transition(transfer, 'receive')}><Package size={13} /> Receive</button>}{access.destination && ['requested','approved'].includes(transfer.status) && <button type="button" className="button button-small button-secondary" disabled={busy} onClick={() => onReject(transfer)}><X size={13} /> Reject</button>}{access.source && ['requested','approved','in_transit'].includes(transfer.status) && <button type="button" className="button button-small button-secondary" disabled={busy} onClick={() => transition(transfer, 'cancel')}><X size={13} /> Cancel / return</button>}</div>;
}

function TransferTimeline({ status }) {
  const steps = ['requested', 'approved', 'in_transit', 'received'];
  if (status === 'rejected' || status === 'cancelled') return <small className={`transfer-terminal ${status}`}>{status === 'rejected' ? 'Request rejected' : 'Transfer cancelled'}</small>;
  const activeIndex = steps.indexOf(status);
  const labels = ['Requested', 'Approved', 'Dispatched', 'Received'];
  return <ol className="transfer-timeline" aria-label={`Transfer progress: ${status.replaceAll('_', ' ')}`}>
    {labels.map((label, index) => <li className={index < activeIndex ? 'complete' : index === activeIndex ? 'current' : ''} key={label}><span aria-hidden="true" />{label}</li>)}
  </ol>;
}
