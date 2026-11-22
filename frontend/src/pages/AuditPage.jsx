import { useEffect, useState } from 'react';
import { Activity, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState, ErrorState, Field, PageHeader, TableSkeleton } from '../components/UI';

export default function AuditPage() {
  const { user } = useAuth(); const isAdmin = user?.role === 'platform_admin';
  const [rows, setRows] = useState([]); const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [pharmacies, setPharmacies] = useState([]); const [pharmacyId, setPharmacyId] = useState('');
  const [action, setAction] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  async function load(page = 1) {
    setLoading(true); setError(null);
    try {
      if (isAdmin && !pharmacies.length) setPharmacies((await api('/pharmacies')).data);
      const query = new URLSearchParams({ page: String(page), limit: '50' });
      if (isAdmin && pharmacyId) query.set('pharmacyId', pharmacyId);
      if (action.trim()) query.set('action', action.trim());
      if (from) query.set('from', from);
      if (to) query.set('to', to);
      const result = await api(`/audit?${query}`); setRows(result.data); setPagination(result.pagination);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }
  useEffect(() => { load(1); }, [pharmacyId]);
  return <>
    <PageHeader eyebrow="GOVERNANCE & TRACEABILITY" title="Audit trail" description="Review recorded changes and operational events within your authorized pharmacy scope." action={<button className="button button-secondary" onClick={() => load(pagination.page)} disabled={loading}><RefreshCw size={15} /> Refresh</button>} />
    <section className="panel table-panel audit-workspace">
      <div className="table-toolbar audit-filters">
        {isAdmin && <Field label="Pharmacy"><select value={pharmacyId} onChange={(e) => setPharmacyId(e.target.value)}><option value="">All pharmacies</option>{pharmacies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
        <Field label="Action"><input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. inventory.adjusted" /></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <button className="button button-primary" onClick={() => load(1)} disabled={loading}><Search size={14} /> Apply</button>
      </div>
      <div className="table-toolbar"><div><h2><ShieldCheck size={17} /> Event history</h2><p>{pagination.total} events in the selected scope</p></div><span className="record-count">Page {pagination.page} / {pagination.pages || 1}</span></div>
      {loading ? <TableSkeleton rows={6} cols={5} /> : error ? <ErrorState error={error} retry={() => load(pagination.page)} /> : rows.length ? <><div className="data-table-wrap"><table className="data-table audit-table"><thead><tr><th>WHEN</th><th>ACTION</th><th>ACTOR</th><th>RECORD</th><th>DETAILS</th></tr></thead><tbody>{rows.map((row) => { const details = row.details ? JSON.stringify(row.details) : '—'; return <tr key={row.id}><td><time dateTime={new Date(row.occurredAt).toISOString()}>{new Date(row.occurredAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time></td><td><span className="audit-action"><Activity size={13} />{row.action}</span></td><td><div className="stacked-cell"><b>{row.userName || 'System'}</b><small>{row.pharmacy || 'Platform'}</small></div></td><td>{row.entityType}{row.entityId ? ` #${row.entityId}` : ''}</td><td><code className="audit-details" title={details}>{details}</code></td></tr>; })}</tbody></table></div><div className="pagination"><span>Page {pagination.page} of {pagination.pages} · {pagination.total} events</span><div><button type="button" className="button button-small button-secondary" disabled={pagination.page <= 1} onClick={() => load(pagination.page - 1)}>Previous</button><button type="button" className="button button-small button-secondary" disabled={pagination.page >= pagination.pages} onClick={() => load(pagination.page + 1)}>Next</button></div></div></> : <EmptyState icon={ShieldCheck} title="No audit events found" text="Operational changes recorded by MediTrack will appear in this register." />}
    </section>
  </>;
}
