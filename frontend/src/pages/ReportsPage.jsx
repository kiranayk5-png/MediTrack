import { useEffect, useState } from 'react';
import { ArrowLeftRight, Download, FileSpreadsheet, RefreshCw, Thermometer, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, PageHeader, StatusPill, TableSkeleton } from '../components/UI';

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const tabs = [
  { id: 'inventory', label: 'Inventory', icon: FileSpreadsheet },
  { id: 'sales', label: 'Sales', icon: TrendingUp },
  { id: 'transfers', label: 'Transfers', icon: ArrowLeftRight },
  { id: 'storage', label: 'Storage', icon: Thermometer },
  { id: 'forecasts', label: 'Forecasts', icon: TrendingUp },
];

function reportTable(tab, rows) {
  if (tab === 'inventory') return <table className="data-table"><thead><tr><th>MEDICINE</th><th>PHARMACY</th><th>BATCH</th><th>ON HAND</th><th>REORDER</th><th>EXPIRY</th><th>SELL PRICE</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.pharmacy}-${row.batchNumber}-${index}`}><td><b>{row.medicine}</b><small className="unit-label">{row.strength || ''}</small></td><td>{row.pharmacy}</td><td>{row.batchNumber}</td><td>{row.quantityOnHand}</td><td>{row.reorderLevel}</td><td>{new Date(row.expiryDate).toLocaleDateString('en-IN')}</td><td>{money.format(row.sellingPrice)}</td></tr>)}</tbody></table>;
  if (tab === 'sales') return <table className="data-table"><thead><tr><th>DATE</th><th>PHARMACY</th><th>TRANSACTIONS</th><th>SUBTOTAL</th><th>DISCOUNTS</th><th>TAX</th><th>REVENUE</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.saleDate}-${row.pharmacy}-${index}`}><td>{new Date(row.saleDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</td><td>{row.pharmacy}</td><td>{row.transactions}</td><td>{money.format(row.subtotal)}</td><td>{money.format(row.discounts)}</td><td>{money.format(row.tax)}</td><td><b>{money.format(row.revenue)}</b></td></tr>)}</tbody></table>;
  if (tab === 'transfers') return <table className="data-table"><thead><tr><th>REQUEST DATE</th><th>SOURCE</th><th>DESTINATION</th><th>STATUS</th><th>TRANSFERS</th><th>UNITS</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.requestDate}-${row.sourcePharmacy}-${row.destinationPharmacy}-${row.status}-${index}`}><td>{new Date(row.requestDate).toLocaleDateString('en-IN')}</td><td>{row.sourcePharmacy}</td><td>{row.destinationPharmacy}</td><td><StatusPill tone={row.status === 'received' ? 'good' : ['rejected', 'cancelled'].includes(row.status) ? 'danger' : 'warning'}>{row.status.replaceAll('_', ' ')}</StatusPill></td><td>{row.transferCount}</td><td>{row.units}</td></tr>)}</tbody></table>;
  if (tab === 'storage') return <table className="data-table"><thead><tr><th>DATE</th><th>PHARMACY</th><th>READINGS</th><th>ALERTS</th><th>AVG TEMP</th><th>MIN / MAX TEMP</th><th>AVG HUMIDITY</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.recordDate}-${row.pharmacy}-${index}`}><td>{new Date(row.recordDate).toLocaleDateString('en-IN')}</td><td>{row.pharmacy}</td><td>{row.readings}</td><td>{row.alerts}</td><td>{row.averageTemperatureC == null ? '—' : `${Number(row.averageTemperatureC).toFixed(1)} °C`}</td><td>{row.minTemperatureC == null ? '—' : `${row.minTemperatureC} / ${row.maxTemperatureC} °C`}</td><td>{row.averageHumidityPercent == null ? '—' : `${Number(row.averageHumidityPercent).toFixed(1)}%`}</td></tr>)}</tbody></table>;
  return <table className="data-table"><thead><tr><th>MEDICINE</th><th>PHARMACY</th><th>FORECAST DATE</th><th>HORIZON</th><th>DEMAND</th><th>REORDER</th><th>DATA QUALITY</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.forecastDate}-${row.medicine}-${row.pharmacy}-${index}`}><td><div className="stacked-cell"><b>{row.medicine}</b><small>{row.explanation}</small></div></td><td>{row.pharmacy}</td><td>{new Date(row.forecastDate).toLocaleDateString('en-IN')}</td><td>{row.horizonDays} days</td><td>{Number(row.predictedDemand).toFixed(2)}</td><td>{Number(row.recommendedReorderQuantity).toFixed(0)}</td><td><StatusPill tone={row.dataQuality === 'adequate' ? 'good' : row.dataQuality === 'limited' ? 'warning' : 'danger'}>{row.dataQuality || 'legacy'}</StatusPill></td></tr>)}</tbody></table>;
}

export default function ReportsPage() {
  const [tab, setTab] = useState('inventory'); const [data, setData] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(null); const toast = useToast();
  async function load() { setLoading(true); setError(null); try { setData((await api(`/reports/${tab}`)).data); } catch (e) { setError(e); } finally { setLoading(false); } }
  useEffect(() => { load(); }, [tab]);
  async function exportCsv() {
    try {
      const response = await api(`/reports/${tab}?format=csv`, { raw: true }); const blob = await response.blob();
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `meditrack-${tab}.csv`; link.click(); URL.revokeObjectURL(url); toast('CSV export downloaded.');
    } catch (e) { toast(e.message, 'error'); }
  }
  const salesMax = Math.max(1, ...data.map((row) => Number(row.revenue) || 0));
  return <>
    <PageHeader eyebrow="INSIGHTS & EXPORTS" title="Reports" description="Explore inventory, completed sales, stock movements, storage exceptions, and explainable forecasts." action={<button className="button button-primary" onClick={exportCsv} disabled={loading}><Download size={16} /> Export CSV</button>} />
    <div className="reports-controls"><div className="report-tabs-wrap"><div className="report-tabs" role="tablist" aria-label="Report type">{tabs.map(({ id, label, icon: Icon }) => <button type="button" role="tab" id={`report-tab-${id}`} aria-controls="report-panel" aria-selected={tab === id} key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={15} /> {label}</button>)}</div><span className="report-tabs-hint" aria-hidden="true">Swipe for more report types</span></div><button type="button" className="button button-secondary report-refresh" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh report</button></div>
    {tab === 'sales' && !loading && !error && data.length > 0 && <section className="panel report-chart-panel"><div className="panel-heading"><div><div className="eyebrow">REVENUE OVER TIME</div><h2>Completed sales</h2><p>Grouped by date and pharmacy · INR</p></div><div className="tiny-icon"><TrendingUp size={18} /></div></div><div className="report-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.slice().reverse()}><CartesianGrid stroke="#ffffff0d" vertical={false} /><XAxis dataKey="saleDate" stroke="#77798b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><YAxis domain={[0, salesMax]} stroke="#77798b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v}`} /><Tooltip contentStyle={{ background: '#202231', border: '1px solid #343648', borderRadius: 12, color: '#fff' }} formatter={(v) => [money.format(v), 'Revenue']} /><Bar dataKey="revenue" fill="#9b7cff" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></section>}
    <section id="report-panel" className="panel table-panel report-table" role="tabpanel" aria-labelledby={`report-tab-${tab}`}><div className="table-toolbar"><div><h2>{tabs.find((item) => item.id === tab)?.label} detail</h2><p>{tab === 'forecasts' ? 'Forecasts include observed-sales coverage and an explanation of the estimate.' : 'Live database records within your authorized scope.'}</p></div><StatusPill tone="neutral">Live database report</StatusPill></div>{loading ? <TableSkeleton rows={6} cols={5} /> : error ? <ErrorState error={error} retry={load} /> : data.length ? <div className="data-table-wrap">{reportTable(tab, data)}</div> : <EmptyState icon={FileSpreadsheet} title="No report rows for this view" text="This report only shows persisted MediTrack data; no sample values are generated in the interface." />}</section>
    <p className="report-footnote">Reports are calculated from stored pharmacy, batch, sale, transfer, storage, and forecast records. Cross-pharmacy access is enforced by the backend.</p>
  </>;
}
