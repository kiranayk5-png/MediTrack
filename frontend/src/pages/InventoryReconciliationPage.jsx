import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ClipboardCheck, ClipboardList, RefreshCw, Save, Send, ShieldCheck } from 'lucide-react';
import { api, json } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { calculateDiscrepancy, canReviewReconciliation, reconciliationReasons } from '../reconciliation';
import { EmptyState, ErrorState, Field, PageHeader, Pagination, StatusPill, TableSkeleton } from '../components/UI';

const statuses = ['draft', 'submitted', 'approved', 'rejected', 'stale'];
const statusTone = (status) => ({ approved: 'good', rejected: 'danger', stale: 'danger', submitted: 'warning', draft: 'neutral' })[status] || 'neutral';

export default function InventoryReconciliationPage() {
  const location = useLocation();
  const { user } = useAuth(); const toast = useToast();
  const isAdmin = user?.role === 'platform_admin';
  const batchTarget = location.state?.batchIds?.length ? location.state : null;
  const [pharmacies, setPharmacies] = useState([]); const [selectedPharmacy, setSelectedPharmacy] = useState(batchTarget?.pharmacyId ? String(batchTarget.pharmacyId) : '');
  const [rows, setRows] = useState([]); const [page, setPage] = useState(1); const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState(null); const [detail, setDetail] = useState(null); const [draft, setDraft] = useState({});
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

  async function loadSessions() {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '10' });
      if (status) params.set('status', status);
      if (isAdmin && selectedPharmacy) params.set('pharmacyId', selectedPharmacy);
      const result = await api(`/reconciliations?${params}`);
      setRows(result.data); setPagination(result.pagination);
      if (selectedId && !result.data.some((row) => Number(row.id) === Number(selectedId)) && !detail) setSelectedId(null);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }

  async function loadDetail(id = selectedId) {
    if (!id) { setDetail(null); return; }
    try { const result = await api(`/reconciliations/${id}`); setDetail(result.data); setDraft(Object.fromEntries(result.data.items.map((item) => [item.batchId, { physicalQuantity: item.physicalQuantity ?? '', reasonCode: item.reasonCode || '', reasonExplanation: item.reasonExplanation || '' }]))); }
    catch (e) { setDetail(null); toast(e.message, 'error'); }
  }

  useEffect(() => { if (isAdmin) api('/pharmacies').then((result) => setPharmacies(result.data)).catch((e) => toast(e.message, 'error')); }, [isAdmin]);
  useEffect(() => { loadSessions(); }, [page, status, selectedPharmacy, isAdmin]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); else setDetail(null); }, [selectedId]);

  async function startSession() {
    if (isAdmin && !selectedPharmacy) { toast('Choose a pharmacy before starting the count.', 'error'); return; }
    setBusy(true);
    try {
      const payload = { ...(isAdmin ? { pharmacyId: Number(selectedPharmacy) } : {}), ...(batchTarget ? { batchIds: batchTarget.batchIds.map(Number) } : {}) };
      const result = await api('/reconciliations', json('POST', payload));
      toast(`Count session started with ${result.itemCount} batch rows.`); setPage(1); setSelectedId(result.id); await loadSessions();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  function editItem(batchId, key, value) {
    setDraft((current) => ({ ...current, [batchId]: { ...current[batchId], [key]: value } }));
  }

  async function saveDraft() {
    if (!detail) return;
    setBusy(true);
    const items = detail.items.map((item) => {
      const values = draft[item.batchId] || {};
      return { batchId: Number(item.batchId), physicalQuantity: values.physicalQuantity === '' ? null : Number(values.physicalQuantity), reasonCode: values.reasonCode || null, reasonExplanation: values.reasonExplanation?.trim() || null };
    });
    try { await api(`/reconciliations/${detail.id}/items`, json('PUT', { items })); toast('Draft count saved.'); await loadDetail(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  async function submitSession() {
    if (!detail) return;
    setBusy(true);
    try { await api(`/reconciliations/${detail.id}/items`, json('PUT', { items: detail.items.map((item) => { const values = draft[item.batchId] || {}; return { batchId: Number(item.batchId), physicalQuantity: values.physicalQuantity === '' ? null : Number(values.physicalQuantity), reasonCode: values.reasonCode || null, reasonExplanation: values.reasonExplanation?.trim() || null }; }) }));
      await api(`/reconciliations/${detail.id}/submit`, json('POST', {})); toast('Reconciliation submitted for manager review.'); await Promise.all([loadDetail(), loadSessions()]); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  async function review(action) {
    if (!detail) return;
    const body = action === 'reject' ? { reason: window.prompt('Enter a reason for rejecting this reconciliation:')?.trim() || '' } : {};
    if (action === 'reject' && body.reason.length < 3) return;
    if (action === 'approve' && !window.confirm('Approve this count and apply its stock adjustments?')) return;
    setBusy(true);
    try { await api(`/reconciliations/${detail.id}/${action}`, json('POST', body)); toast(action === 'approve' ? 'Adjustments approved and stock updated.' : 'Reconciliation rejected; inventory was not changed.'); await Promise.all([loadDetail(), loadSessions()]); }
    catch (e) { toast(e.message, 'error'); await Promise.all([loadDetail(), loadSessions()]); } finally { setBusy(false); }
  }

  const countSummary = useMemo(() => detail?.summary || { itemCount: 0, countedCount: 0, discrepancyCount: 0, discrepancyUnits: 0 }, [detail]);
  const countedNow = detail?.items.filter((item) => draft[item.batchId]?.physicalQuantity !== '').length || 0;
  const canEdit = detail?.status === 'draft' && Number(user?.id) === Number(detail.createdBy);
  const canReview = canReviewReconciliation(user, detail);

  return <>
    <PageHeader eyebrow="STOCK CONTROL" title="Inventory reconciliation" description="Compare physical batch counts with system balances and route discrepancies for independent review." action={<button className="button button-secondary" onClick={loadSessions} disabled={loading}><RefreshCw size={15} /> Refresh sessions</button>} />
    <section className="panel workflow-panel reconciliation-start"><div className="table-toolbar"><div><h2><ClipboardCheck size={17} /> Start a physical count</h2><p>{batchTarget ? `This count is focused on ${batchTarget.medicineName} · ${batchTarget.batchNumber}.` : 'Each session snapshots current batch balances and stock history for stale-count detection.'}</p></div><StatusPill tone="neutral">Approval required</StatusPill></div><div className="reconciliation-start-actions">{isAdmin ? <Field label="Pharmacy to count"><select aria-label="Pharmacy to count" value={selectedPharmacy} onChange={(event) => setSelectedPharmacy(event.target.value)}><option value="">Choose pharmacy</option>{pharmacies.map((pharmacy) => <option value={pharmacy.id} key={pharmacy.id}>{pharmacy.name}</option>)}</select></Field> : <div className="form-note"><ShieldCheck size={14} /> Pharmacy is assigned by your account and enforced by the API.</div>}<button className="button button-primary" onClick={startSession} disabled={busy || (isAdmin && !selectedPharmacy)}><ClipboardCheck size={15} /> {busy ? 'Starting…' : batchTarget ? 'Start batch count' : 'Start count session'}</button></div></section>

    <section className="panel table-panel reconciliation-sessions"><div className="table-toolbar"><div><h2><ClipboardList size={17} /> Reconciliation sessions</h2><p>{pagination.total} sessions in this scope</p></div><label className="field reconciliation-filter"><span>Session status</span><select aria-label="Filter by session status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label></div>
      {loading ? <TableSkeleton rows={5} cols={5} /> : error ? <ErrorState error={error} retry={loadSessions} /> : rows.length ? <><div className="data-table-wrap"><table className="data-table"><thead><tr><th>SESSION</th><th>PHARMACY</th><th>STARTED BY</th><th>COUNT SUMMARY</th><th>STATUS</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><div className="stacked-cell"><b>Count #{row.id}</b><small>{new Date(row.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</small></div></td><td>{row.pharmacy}</td><td>{row.createdByName}</td><td><div className="stacked-cell"><b>{row.countedCount}/{row.itemCount} counted</b><small>{row.discrepancyCount} discrepant batches · {row.discrepancyUnits} units</small></div></td><td><StatusPill tone={statusTone(row.status)}>{row.status.replaceAll('_', ' ')}</StatusPill></td><td><button type="button" className="button button-small button-secondary" onClick={() => setSelectedId(row.id)}>{Number(selectedId) === Number(row.id) ? 'Selected' : 'Open session'}</button></td></tr>)}</tbody></table></div><Pagination page={pagination.page} pages={pagination.pages} onChange={setPage} /></> : <EmptyState icon={ClipboardCheck} title="No reconciliation sessions" text="Start a count session to capture physical stock against current batch balances." />}
    </section>

    {detail && <section className="panel table-panel reconciliation-detail"><div className="table-toolbar"><div><div className="eyebrow">COUNT SESSION #{detail.id} · {detail.pharmacy}</div><h2>Batch count details</h2><p>Started by {detail.createdByName} · {countSummary.countedCount} of {countSummary.itemCount} counted · {countSummary.discrepancyCount} discrepancies</p></div><StatusPill tone={statusTone(detail.status)}>{detail.status.replaceAll('_', ' ')}</StatusPill></div>{detail.reviewNote && <div className={`form-note ${detail.status === 'stale' ? 'reconciliation-stale-note' : ''}`} role="status">{detail.reviewNote}</div>}
      {detail.items.length ? <div className="data-table-wrap"><table className="data-table reconciliation-table"><thead><tr><th>MEDICINE / BATCH</th><th>EXPIRY</th><th>SYSTEM QTY</th><th>PHYSICAL QTY</th><th>DISCREPANCY</th><th>REASON</th></tr></thead><tbody>{detail.items.map((item) => { const values = draft[item.batchId] || {}; const discrepancy = calculateDiscrepancy(values.physicalQuantity, item.systemQuantity); return <tr key={item.batchId}><td><div className="stacked-cell"><b>{item.medicineName} {item.strength}</b><small>{item.batchNumber}</small></div></td><td>{new Date(item.expiryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td><td>{item.systemQuantity}</td><td>{canEdit ? <input aria-label={`Physical quantity for ${item.batchNumber}`} className="reconciliation-number" type="number" min="0" max="4294967295" step="1" value={values.physicalQuantity ?? ''} onChange={(event) => editItem(item.batchId, 'physicalQuantity', event.target.value)} /> : item.physicalQuantity ?? 'Not counted'}</td><td><strong className={discrepancy > 0 ? 'reconciliation-positive' : discrepancy < 0 ? 'quantity-low' : ''}>{discrepancy == null ? '—' : discrepancy > 0 ? `+${discrepancy}` : discrepancy}</strong></td><td>{canEdit ? <div className="reconciliation-reason"><select aria-label={`Reason for ${item.batchNumber}`} value={values.reasonCode || ''} onChange={(event) => editItem(item.batchId, 'reasonCode', event.target.value)}><option value="">Choose reason</option>{reconciliationReasons.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select>{values.reasonCode === 'other' && <input aria-label={`Explanation for ${item.batchNumber}`} value={values.reasonExplanation || ''} maxLength="220" placeholder="Explain reason" onChange={(event) => editItem(item.batchId, 'reasonExplanation', event.target.value)} />}</div> : <div className="stacked-cell"><span>{reconciliationReasons.find(([code]) => code === item.reasonCode)?.[1] || (discrepancy === 0 ? 'No discrepancy' : '—')}</span>{item.reasonExplanation && <small>{item.reasonExplanation}</small>}</div>}</td></tr>; })}</tbody></table></div> : <EmptyState title="No batches in this session" text="This session has no inventory rows to reconcile." />}
      {detail.status === 'draft' && canEdit && <div className="reconciliation-actions"><span className="field-hint">Discrepancies require a reason. “Other” requires an explanation. Submission locks the count for review.</span><div className="action-row"><button type="button" className="button button-secondary" disabled={busy} onClick={saveDraft}><Save size={15} /> Save draft</button><button type="button" className="button button-primary" disabled={busy || countedNow !== countSummary.itemCount} onClick={submitSession}><Send size={15} /> Submit for review</button></div></div>}
      {canReview && <div className="reconciliation-actions"><span className="field-hint">Approval rechecks stock under lock and applies every discrepancy atomically. You cannot approve your own count.</span><div className="action-row"><button type="button" className="button button-secondary" disabled={busy} onClick={() => review('reject')}>Reject with reason</button><button type="button" className="button button-primary" disabled={busy} onClick={() => review('approve')}><ShieldCheck size={15} /> Approve adjustments</button></div></div>}
      {detail.status === 'stale' && <div className="form-note reconciliation-stale-note">This count was not applied because stock changed after the snapshot. Start a new reconciliation and recount.</div>}
    </section>}
  </>;
}
