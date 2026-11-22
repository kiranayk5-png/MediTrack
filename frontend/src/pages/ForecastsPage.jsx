import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Info, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, json } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, Field, PageHeader, StatusPill, TableSkeleton } from '../components/UI';
import { formatForecastCoverageSummary, getForecastChartRows, summarizeForecastCoverage } from '../forecastPresentation';

function ForecastMedicineTick({ x, y, payload }) {
  const name = String(payload?.value || 'Medicine');
  const visibleName = name.length > 24 ? `${name.slice(0, 23)}…` : name;
  return <g transform={`translate(${x},${y})`}>
    <title>{name}</title>
    <text x={-8} y={4} textAnchor="end" fill="#aeb6ca" fontSize={10} aria-label={name}>{visibleName}</text>
  </g>;
}

function ForecastChartTooltip({ active, payload }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="forecast-chart-tooltip" role="status">
    <b>{row.medicineName}</b>
    <span><i />Forecast demand <strong>{Number(row.predictedDemand).toFixed(2)} units</strong></span>
    <small>{row.horizonDays}-day horizon · {row.pharmacy || `Pharmacy ${row.pharmacyId}`}</small>
    {row.dataQuality && <small>Sales history: {row.dataQuality.replaceAll('_', ' ')}</small>}
  </div>;
}

export default function ForecastsPage() {
  const { user } = useAuth(); const toast = useToast(); const isAdmin = user?.role === 'platform_admin';
  const [rows, setRows] = useState([]); const [pharmacies, setPharmacies] = useState([]); const [pharmacyId, setPharmacyId] = useState(user?.pharmacyId ? String(user.pharmacyId) : '');
  const [horizonDays, setHorizonDays] = useState('30'); const [lookbackDays, setLookbackDays] = useState('90'); const [generationNotice, setGenerationNotice] = useState('');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(null); const canGenerate = ['platform_admin', 'pharmacy_manager'].includes(user?.role);
  async function load() {
    setLoading(true); setError(null);
    try {
      if (isAdmin && !pharmacies.length) setPharmacies((await api('/pharmacies')).data);
      setRows((await api(`/forecasts${isAdmin && pharmacyId ? `?pharmacyId=${encodeURIComponent(pharmacyId)}` : ''}`)).data);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [pharmacyId]);
  async function generate(event) {
    event.preventDefault(); setBusy(true);
    setGenerationNotice('');
    const body = { horizonDays: Number(horizonDays), lookbackDays: Number(lookbackDays) };
    if (isAdmin) body.pharmacyId = Number(pharmacyId);
    try {
      const result = await api('/forecasts/generate', json('POST', body));
      if (!result.generated) setGenerationNotice(result.message || 'No completed sales were found in the selected history window. No forecasts were stored.');
      toast(result.generated ? `Generated ${result.generated} forecasts from completed sales.` : result.message, result.generated ? 'success' : 'error');
      await load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  const qualityTone = (quality) => quality === 'adequate' ? 'good' : quality === 'limited' ? 'warning' : 'danger';
  const chartRows = getForecastChartRows(rows);
  const coverage = summarizeForecastCoverage(rows);
  const coverageMessage = formatForecastCoverageSummary(coverage);
  return <>
    <PageHeader eyebrow="DEMAND PLANNING" title="Demand forecasts" description="Explainable moving-average estimates calculated from completed historical sales and eligible on-hand stock." action={<button className="button button-secondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>} />
    {isAdmin && <div className="panel scope-bar"><Field label="Pharmacy scope"><select value={pharmacyId} onChange={(e) => { setPharmacyId(e.target.value); setGenerationNotice(''); }}><option value="">All pharmacies</option>{pharmacies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></div>}
    {generationNotice && <div className="forecast-data-notice" role="status"><AlertTriangle size={17} /><div><b>No forecasts generated</b><p>{generationNotice}</p></div></div>}
    {canGenerate && <section className="panel workflow-panel forecast-generator"><div className="table-toolbar"><div><h2><Sparkles size={17} /> Generate estimate</h2><p>Only completed sale items are used; voided and refunded transactions are excluded.</p></div></div><form className="form-stack workflow-form" onSubmit={generate}><div className="form-grid">
      <Field label="Forecast horizon"><select value={horizonDays} onChange={(e) => setHorizonDays(e.target.value)}><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="90">90 days</option></select></Field>
      <Field label="Sales lookback"><select value={lookbackDays} onChange={(e) => setLookbackDays(e.target.value)}><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option><option value="180">180 days</option></select></Field>
    </div><div className="form-note"><Info size={14} /> Daily rate = units sold ÷ calendar days in the lookback. Recommended reorder = forecast demand minus non-expired, non-recalled units, rounded up. This simple estimate does not model seasonality or lead time.</div><div className="workflow-actions"><button className="button button-primary" disabled={busy || (isAdmin && !pharmacyId)}><Activity size={15} /> {busy ? 'Calculating…' : 'Generate forecasts'}</button></div></form></section>}
    <section className="panel table-panel module-table forecast-history"><div className="table-toolbar"><div><h2><TrendingUp size={17} /> Forecast history</h2><p>Saved estimates include input coverage and a plain-language explanation.</p></div><span className="record-count">{rows.length} forecasts</span></div>
      {loading ? <TableSkeleton rows={5} cols={6} /> : error ? <ErrorState error={error} retry={load} /> : rows.length ? <>
        {coverageMessage && <div className="forecast-coverage-notice" role="note"><AlertTriangle size={17} /><p><b>Review historical coverage.</b> {coverageMessage}</p></div>}
        <div className="forecast-chart" style={{ height: `${Math.min(430, Math.max(220, chartRows.length * 36 + 56))}px` }} role="group" aria-label={`Forecast demand bar chart for ${chartRows.length} medicines`}><ResponsiveContainer width="100%" height="100%"><BarChart accessibilityLayer layout="vertical" data={chartRows} barCategoryGap="30%" margin={{ left: 4, right: 28, top: 8, bottom: 8 }}><CartesianGrid stroke="#ffffff0d" horizontal={false} /><XAxis type="number" stroke="#7f89a1" tickLine={false} axisLine={false} tick={{ fontSize: 9 }} tickFormatter={(value) => `${value}`} /><YAxis type="category" dataKey="medicineName" width={180} interval={0} tick={<ForecastMedicineTick />} tickLine={false} axisLine={false} /><Tooltip content={<ForecastChartTooltip />} cursor={{ fill: 'rgba(167,139,250,.08)' }} /><Bar dataKey="predictedDemand" name="Forecast demand" fill="#9b7cff" radius={[0, 5, 5, 0]} maxBarSize={22} /></BarChart></ResponsiveContainer></div>
        <div className="data-table-wrap forecast-table-wrap"><table className="data-table forecast-data-table"><thead><tr><th>MEDICINE</th><th>PHARMACY</th><th>HORIZON</th><th>DEMAND</th><th>REORDER</th><th>SALES COVERAGE</th><th>DATA QUALITY</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><div className="forecast-medicine-cell"><b>{row.medicineName}</b><details className="forecast-explanation"><summary>Methodology &amp; data notes</summary><p>{row.explanation || 'No explanation was stored for this legacy forecast.'}</p></details></div></td><td>{row.pharmacy || `Pharmacy ${row.pharmacyId}`}</td><td><span className="forecast-numeric">{row.horizonDays} days</span></td><td><strong className="forecast-demand">{Number(row.predictedDemand).toFixed(2)} <small>units</small></strong></td><td><strong className="forecast-reorder">{Number(row.recommendedReorderQuantity).toFixed(0)} <small>units</small></strong></td><td><span className="forecast-coverage-value">{row.observedSalesDays ?? '—'} <small>sales days</small></span><small className="forecast-lookback">of {row.lookbackDays ?? '—'} calendar days</small></td><td><div className="forecast-quality-cell"><StatusPill tone={qualityTone(row.dataQuality)}>{(row.dataQuality || 'legacy').replaceAll('_', ' ')}</StatusPill>{row.dataQuality === 'insufficient' && <small>Insufficient history</small>}{row.dataQuality === 'limited' && <small>Less reliable estimate</small>}</div></td></tr>)}</tbody></table></div>
      </> : <EmptyState icon={TrendingUp} title="No forecast history yet" text="Generate an estimate after completed sales are available. The system does not create predictions from sample values." />}
    </section>
  </>;
}
