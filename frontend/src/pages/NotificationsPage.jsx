import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Circle, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../notificationsApi';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, PageHeader, StatusPill, TableSkeleton } from '../components/UI';

const typeLabels = {
  medicine_expiry: 'Medicine expiry', low_stock: 'Low stock', stock_transfer: 'Stock transfer', storage_violation: 'Storage condition',
};

function notifyShell() {
  window.dispatchEvent(new Event('meditrack:notifications-changed'));
}

export default function NotificationsPage() {
  const toast = useToast();
  const [data, setData] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 });
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const didInitialRefresh = useRef(false);

  async function load(forceRefresh = false) {
    setLoading(true); setError(null);
    try {
      if (forceRefresh || !didInitialRefresh.current) {
        await api('/notifications/refresh', { method: 'POST' });
        didInitialRefresh.current = true;
      }
      const result = await listNotifications({ page, status, type, severity }, api);
      setData(result.data); setPagination(result.pagination); setUnreadCount(result.unreadCount);
    } catch (requestError) { setError(requestError); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [page, status, type, severity]);

  async function markRead(id) {
    setBusy(true);
    try { await markNotificationRead(id, api); toast('Notification marked as read.'); notifyShell(); await load(); }
    catch (requestError) { toast(requestError.message, 'error'); }
    finally { setBusy(false); }
  }

  async function markAllRead() {
    setBusy(true);
    try { const result = await markAllNotificationsRead(api); toast(`${result.updated} notification${result.updated === 1 ? '' : 's'} marked as read.`); notifyShell(); await load(); }
    catch (requestError) { toast(requestError.message, 'error'); }
    finally { setBusy(false); }
  }

  const setFilter = (setter) => (event) => { setter(event.target.value); setPage(1); };
  return <>
    <PageHeader eyebrow="NOTIFICATION CENTER" title="Notifications" description="Pharmacy-scoped expiry, stock, transfer, and storage events." action={<div className="notification-header-actions"><span className="notification-unread-total">{unreadCount} unread</span><button className="button button-secondary" type="button" onClick={() => load(true)} disabled={loading}><RefreshCw size={14} /> Refresh</button><button className="button button-primary" type="button" onClick={markAllRead} disabled={busy || unreadCount === 0}><CheckCheck size={14} /> Mark all read</button></div>} />
    <section className="panel notification-filters" aria-label="Notification filters">
      <label className="field"><span>Read status</span><select value={status} onChange={setFilter(setStatus)}><option value="all">All active</option><option value="unread">Unread</option><option value="read">Read</option></select></label>
      <label className="field"><span>Category</span><select value={type} onChange={setFilter(setType)}><option value="">All categories</option>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="field"><span>Severity</span><select value={severity} onChange={setFilter(setSeverity)}><option value="">All severities</option>{['critical', 'high', 'medium', 'low'].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
    </section>
    {error ? <ErrorState error={error} retry={load} /> : <section className="panel notification-list" aria-label="Notifications">
      {loading ? <TableSkeleton rows={5} cols={4} /> : data.length ? <>
        <div className="notification-list-meta"><span>{pagination.total} notification{pagination.total === 1 ? '' : 's'}</span><span>Page {pagination.page} of {Math.max(pagination.pages, 1)}</span></div>
        {data.map((item) => <article className={`notification-row ${item.isRead ? 'is-read' : 'is-unread'}`} key={item.id}>
          <div className={`notification-symbol severity-${item.severity}`}><Bell size={17} /></div>
          <div className="notification-content"><div className="notification-title-row"><h2>{item.title}</h2><StatusPill tone={item.severity === 'critical' || item.severity === 'high' ? 'danger' : item.severity === 'medium' ? 'warning' : 'neutral'}>{item.severity}</StatusPill></div>
            <p>{item.message}</p><div className="notification-meta"><span>{typeLabels[item.type] || item.type.replaceAll('_', ' ')}</span>{item.pharmacy && <><span aria-hidden="true">·</span><span>{item.pharmacy}</span></>}<span aria-hidden="true">·</span><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time>{item.resolvedAt && <StatusPill tone="neutral">Resolved</StatusPill>}</div>
          </div>
          <div className="notification-row-action">{item.isRead ? <StatusPill tone="neutral">Read</StatusPill> : <><span className="notification-unread-dot"><Circle size={8} fill="currentColor" /></span><button className="button button-secondary button-small" type="button" onClick={() => markRead(item.id)} disabled={busy}>Mark read</button></>}</div>
        </article>)}
        <div className="notification-pagination"><button type="button" className="button button-secondary button-small" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button><button type="button" className="button button-secondary button-small" disabled={page >= pagination.pages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div>
      </> : <EmptyState icon={Bell} title="No notifications" text="There are no active notifications for the selected filters." />}
    </section>}
  </>;
}
