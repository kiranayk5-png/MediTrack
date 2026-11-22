import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowRight, Boxes, CalendarClock, CircleAlert, Clock3, Package,
  Pill, RefreshCw, ShoppingBag, TriangleAlert,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/UI';
import { buildInventoryHealthSignals, buildSalesSeries, buildStockByMedicine, buildStockStatusDistribution, salesEmptyMessage } from '../dashboardAnalytics';
import { getWorkspaceName } from '../workspaceName';

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const count = new Intl.NumberFormat('en-IN');
const statusPalette = ['#5fc4d8', '#a78bfa', '#e6ad60', '#e87987', '#63c7a4'];

function formatDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function MetricCard({ label, value, detail, icon: Icon, tone, status, to }) {
  return <Link className={`dashboard-metric metric-card ${tone}`} to={to} aria-label={`${label}: ${value}. ${detail}`}>
    <div className="dashboard-metric-top"><span>{label}</span><span className={`dashboard-metric-icon ${tone}`}><Icon aria-hidden="true" size={18} /></span></div>
    <strong className="dashboard-metric-value">{value}</strong>
    <div className="dashboard-metric-bottom"><span>{detail}</span><span className={`dashboard-metric-status ${status.tone}`}>{status.label}</span></div>
  </Link>;
}

function ChartTooltip({ active, payload, label, mode = 'count' }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const title = mode === 'date' ? formatDate(label) : (row.label || row.name || row.status || label);
  return <div className="premium-chart-tooltip"><b>{title}</b>{payload.map((entry) => <div key={entry.dataKey}>
    <i style={{ background: entry.color || entry.fill || '#a78bfa' }} />
    <span>{entry.name || (mode === 'currency' ? 'Revenue' : 'Batches')}</span>
    <strong>{mode === 'currency' ? money.format(Number(entry.value)) : count.format(Number(entry.value))}</strong>
  </div>)}</div>;
}

function DashboardSkeleton() {
  return <div className="dashboard-skeleton" role="status" aria-label="Loading dashboard">
    <Spinner label="Loading live pharmacy data" />
    <div className="dashboard-skeleton-metrics" aria-hidden="true">{[0, 1, 2, 3].map((item) => <div key={item} />)}</div>
    <div className="dashboard-skeleton-charts" aria-hidden="true"><div /><div /></div>
  </div>;
}

function ChartPanel({ eyebrow, title, description, children, footer, className = '' }) {
  return <section className={`panel analytics-panel ${className}`}>
    <div className="analytics-panel-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div></div>
    {children}
    {footer && <div className="analytics-panel-footer">{footer}</div>}
  </section>;
}

function RiskLink({ label, value, detail, to, tone, icon: Icon }) {
  return <Link className={`risk-link ${tone}`} to={to}>
    <span className="risk-link-icon"><Icon size={16} aria-hidden="true" /></span>
    <span className="risk-link-copy"><b>{label}</b><small>{detail}</small></span>
    <strong>{count.format(value)}</strong><ArrowRight size={15} aria-hidden="true" />
  </Link>;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pharmacies, setPharmacies] = useState([]);
  const [unreadCount, setUnreadCount] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api('/dashboard'));
      setLastUpdated(new Date());
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let active = true;
    if (!user?.pharmacyId) { setPharmacies([]); return () => { active = false; }; }
    api('/pharmacies').then((result) => { if (active) setPharmacies(result.data || []); })
      .catch(() => { if (active) setPharmacies([]); });
    return () => { active = false; };
  }, [user?.pharmacyId]);
  useEffect(() => {
    let active = true;
    api('/notifications/unread-count').then((result) => { if (active) setUnreadCount(Number(result.count) || 0); })
      .catch(() => { if (active) setUnreadCount(null); });
    return () => { active = false; };
  }, [user?.id]);

  const metrics = data?.metrics;
  const sales = useMemo(() => buildSalesSeries(data?.salesTrend), [data?.salesTrend]);
  const healthSignals = useMemo(() => buildInventoryHealthSignals(metrics), [metrics]);
  const stockByMedicine = useMemo(() => buildStockByMedicine(data?.stockByMedicine), [data?.stockByMedicine]);
  const statusDistribution = useMemo(() => buildStockStatusDistribution(data?.stockStatusDistribution), [data?.stockStatusDistribution]);
  const workspaceName = getWorkspaceName(user, pharmacies);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.trim().split(/\s+/)[0];
  const dateLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());

  return <>
    <PageHeader eyebrow={dateLabel.toUpperCase()} title={`${greeting}${firstName ? `, ${firstName}` : ''}`} description={`Your operational overview for ${workspaceName}.`} action={<button className="button button-secondary dashboard-refresh" type="button" onClick={load} disabled={loading} aria-label="Refresh dashboard data" aria-busy={loading}><RefreshCw size={15} className={loading ? 'subtle-spin' : ''} />{loading ? 'Refreshing' : 'Refresh data'}</button>} />
    {!data && loading && <DashboardSkeleton />}
    {error && <ErrorState error={error} retry={load} />}
    {data && metrics && <>
      <div className="dashboard-context dashboard-context-premium">
        <div className="context-mark"><Activity size={17} /></div>
        <div className="context-workspace"><span>AUTHORIZED WORKSPACE</span><b>{workspaceName}</b></div>
        <span className="context-divider" />
        <div className="context-status"><i className="online-dot" /> Data from MediTrack records</div>
        {lastUpdated && <span className="dashboard-updated"><Clock3 size={13} /> Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
        {unreadCount !== null && <Link to="/notifications" className={`context-alerts ${unreadCount ? 'has-alerts' : ''}`}><TriangleAlert size={14} />{count.format(unreadCount)} unread</Link>}
      </div>

      <section className="dashboard-kpis" aria-label="Pharmacy key performance indicators">
        <MetricCard label="Medicine catalogue" value={count.format(Number(metrics.totalMedicines) || 0)} detail="Active formulations" icon={Pill} tone="violet" status={{ label: 'Catalogue', tone: 'neutral' }} to="/medicines" />
        <MetricCard label="Sellable stock" value={count.format(Number(metrics.availableUnits) || 0)} detail="Eligible, unexpired units" icon={Boxes} tone="cyan" status={{ label: 'On hand', tone: 'good' }} to="/inventory" />
        <MetricCard label="Low stock" value={count.format(Number(metrics.lowStockBatches) || 0)} detail="Batches at reorder point" icon={Package} tone="amber" status={{ label: Number(metrics.lowStockBatches) ? 'Review' : 'Clear', tone: Number(metrics.lowStockBatches) ? 'warning' : 'good' }} to="/inventory" />
        <MetricCard label="Expiry watch" value={count.format(Number(metrics.expiringBatches) || 0)} detail="Batches expiring within 30 days" icon={CalendarClock} tone="rose" status={{ label: Number(metrics.expiringBatches) ? 'Attention' : 'Clear', tone: Number(metrics.expiringBatches) ? 'warning' : 'good' }} to="/alerts" />
      </section>

      <section className="dashboard-today panel" aria-label="Today's operational summary">
        <div className="dashboard-today-heading"><div><span className="eyebrow">TODAY AT A GLANCE</span><h2>Operational summary</h2></div><Link to="/sales" className="text-link">Open point of sale <ArrowRight size={14} /></Link></div>
        <div className="dashboard-today-grid">
          <div className="today-stat"><span className="today-stat-icon revenue"><ShoppingBag size={16} /></span><span><small>Completed sales</small><b>{money.format(Number(metrics.todayRevenue) || 0)}</b></span><em>{count.format(Number(metrics.todayTransactions) || 0)} transactions</em></div>
          <div className="today-stat"><span className="today-stat-icon expired"><TriangleAlert size={16} /></span><span><small>Expired stock</small><b>{count.format(Number(metrics.expiredBatches) || 0)} batches</b></span><Link to="/alerts">Review expiry <ArrowRight size={12} /></Link></div>
          <div className="today-stat"><span className="today-stat-icon workspace"><Boxes size={16} /></span><span><small>Scope</small><b>{workspaceName}</b></span><span className="today-scope-note">Pharmacy-isolated data</span></div>
        </div>
      </section>

      <div className="analytics-grid">
        <ChartPanel eyebrow="SALES PERFORMANCE" title="Revenue trend" description="Completed sales returned by the dashboard for the last seven days." className="sales-analytics-panel" footer={<><span><i className="legend-dot violet-dot" /> Revenue</span><span>{count.format(sales.reduce((sum, row) => sum + row.transactions, 0))} recorded transactions</span></>}>
          {sales.length ? <div className="dashboard-chart sales-trend-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart accessibilityLayer data={sales} margin={{ top: 12, right: 14, bottom: 0, left: 0 }}>
            <defs><linearGradient id="dashboardRevenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#9b83f1" stopOpacity={.28} /><stop offset="95%" stopColor="#9b83f1" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid stroke="rgba(190,198,224,.09)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fill: '#929bb2', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tick={{ fill: '#929bb2', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(value) => `₹${count.format(value)}`} width={62} />
            <Tooltip content={<ChartTooltip mode="currency" />} cursor={{ stroke: 'rgba(196,181,253,.35)', strokeDasharray: '4 4' }} />
            <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#b29cff" strokeWidth={2.5} fill="url(#dashboardRevenueFill)" activeDot={{ r: 5, fill: '#d4c7ff', stroke: '#171a29', strokeWidth: 2 }} animationDuration={450} />
          </AreaChart></ResponsiveContainer></div> : <EmptyState icon={ShoppingBag} title="No sales trend yet" text={salesEmptyMessage(sales)} action={<Link className="button button-secondary button-small" to="/sales">Go to point of sale</Link>} />}
        </ChartPanel>

        <ChartPanel eyebrow="INVENTORY HEALTH" title="Batch risk signals" description="Counts of batches currently flagged by each safety rule." className="health-analytics-panel" footer={<span><TriangleAlert size={13} /> A batch can be included in more than one signal.</span>}>
          {healthSignals.length ? <div className="dashboard-chart health-chart"><ResponsiveContainer width="100%" height="100%"><BarChart accessibilityLayer data={healthSignals} layout="vertical" margin={{ top: 3, right: 25, bottom: 3, left: 4 }}>
            <CartesianGrid stroke="rgba(190,198,224,.08)" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fill: '#929bb2', fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="label" width={105} tick={{ fill: '#c4cada', fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,.035)' }} />
            <Bar dataKey="value" name="Batches" radius={[0, 6, 6, 0]} barSize={18} animationDuration={450}>{healthSignals.map((item) => <Cell key={item.key} fill={item.color} />)}</Bar>
          </BarChart></ResponsiveContainer></div> : <EmptyState icon={Boxes} title="Inventory signals unavailable" text="The dashboard response did not include batch risk counts." />}
          <div className="health-chart-links"><Link to="/inventory">Review inventory <ArrowRight size={13} /></Link><Link to="/alerts">Open safety alerts <ArrowRight size={13} /></Link></div>
        </ChartPanel>

        <ChartPanel eyebrow="ELIGIBLE STOCK" title="Sellable units by medicine" description="Top medicines by unexpired, non-recalled on-hand quantity." className="stock-analytics-panel" footer={<><span><i className="legend-dot cyan-dot" /> Sellable units</span><span>Top {stockByMedicine.length} from dashboard results</span></>}>
          {stockByMedicine.length ? <div className="dashboard-chart product-stock-chart"><ResponsiveContainer width="100%" height="100%"><BarChart accessibilityLayer data={stockByMedicine} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 6 }}>
            <CartesianGrid stroke="rgba(190,198,224,.08)" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fill: '#929bb2', fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={142} tick={{ fill: '#c4cada', fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,.035)' }} />
            <Bar dataKey="quantity" name="Units" fill="#58bfd4" radius={[0, 6, 6, 0]} barSize={15} animationDuration={450} />
          </BarChart></ResponsiveContainer></div> : <EmptyState icon={Boxes} title="No eligible stock" text="No unexpired, non-recalled inventory was returned for this workspace." action={<Link className="button button-secondary button-small" to="/inventory">View inventory</Link>} />}
        </ChartPanel>

        <ChartPanel eyebrow="STOCK STATUS" title="Status distribution" description="Distribution by distinct batch status across the authorized workspace." className="distribution-analytics-panel">
          {statusDistribution.length ? <div className="dashboard-chart status-distribution-chart"><ResponsiveContainer width="100%" height="100%"><PieChart accessibilityLayer>
            <Pie data={statusDistribution} dataKey="count" nameKey="status" innerRadius={62} outerRadius={94} paddingAngle={3} stroke="none" animationDuration={450}>{statusDistribution.map((item, index) => <Cell key={item.status} fill={statusPalette[index % statusPalette.length]} />)}</Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart></ResponsiveContainer><ul className="distribution-legend">{statusDistribution.map((item, index) => <li key={item.status}><i style={{ background: statusPalette[index % statusPalette.length] }} /><span>{item.status}</span><b>{count.format(item.count)}</b></li>)}</ul></div> : <EmptyState icon={Boxes} title="Breakdown not available" text="The current dashboard API does not return mutually exclusive batch-status totals, so a stock distribution chart cannot be calculated accurately." action={<Link className="button button-secondary button-small" to="/inventory">View batch inventory</Link>} />}
        </ChartPanel>
      </div>

      <div className="dashboard-operations-grid">
        <section className="panel operational-insights"><div className="analytics-panel-heading"><div><span className="eyebrow">ACTION REQUIRED</span><h2>Safety & stock attention</h2><p>Live counts from inventory and notification endpoints.</p></div><Link to="/alerts" className="text-link">All safety alerts <ArrowRight size={14} /></Link></div>
          <div className="risk-link-list">
            <RiskLink label="Low stock batches" value={Number(metrics.lowStockBatches) || 0} detail="At or below reorder level" to="/inventory" tone="amber" icon={Package} />
            <RiskLink label="Expiring soon" value={Number(metrics.expiringBatches) || 0} detail="Expiry within 30 days" to="/alerts" tone="violet" icon={CalendarClock} />
            <RiskLink label="Expired stock" value={Number(metrics.expiredBatches) || 0} detail="Batches with units on hand" to="/alerts" tone="rose" icon={TriangleAlert} />
            {unreadCount !== null && <RiskLink label="Unread notifications" value={unreadCount} detail="Expiry, stock, transfer and storage events" to="/notifications" tone="cyan" icon={CircleAlert} />}
          </div>
        </section>

        <section className="panel dashboard-activity"><div className="analytics-panel-heading"><div><span className="eyebrow">TEAM ACTIVITY</span><h2>Recent activity</h2><p>Latest actions recorded by your team.</p></div><Link to="/reports" className="text-link">Reports <ArrowRight size={14} /></Link></div>
          {data.recentActivity?.length ? <ol className="activity-timeline">{data.recentActivity.map((row) => <li key={row.id}><span className="activity-timeline-icon"><Activity size={14} /></span><div className="activity-timeline-content"><b>{String(row.action || 'Activity').replaceAll('.', ' ')}</b><span>{row.userName || 'System'} · {row.entityType || 'record'}{row.entityId ? ` #${row.entityId}` : ''}</span><time dateTime={row.occurredAt}>{new Date(row.occurredAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time></div></li>)}</ol> : <EmptyState icon={Activity} title="No recent activity" text="Recorded team actions will appear here." />}
        </section>
      </div>
    </>}
  </>;
}
