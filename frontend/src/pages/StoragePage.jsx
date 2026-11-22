import { useEffect, useState } from 'react';
import { AlertTriangle, Check, ClipboardCheck, RefreshCw, Save, Thermometer } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, json } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, Field, PageHeader, StatusPill, TableSkeleton } from '../components/UI';

const emptyPolicy = { minTemperatureC: '', maxTemperatureC: '', minHumidityPercent: '', maxHumidityPercent: '' };

export default function StoragePage() {
  const { user } = useAuth(); const toast = useToast(); const isAdmin = user?.role === 'platform_admin';
  const [pharmacies, setPharmacies] = useState([]); const [pharmacyId, setPharmacyId] = useState(user?.pharmacyId ? String(user.pharmacyId) : '');
  const [policy, setPolicy] = useState(null); const [logs, setLogs] = useState([]); const [alertsOnly, setAlertsOnly] = useState(false);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      if (!pharmacyId) { setPolicy(null); setLogs([]); return; }
      const scope = isAdmin ? `?pharmacyId=${encodeURIComponent(pharmacyId)}` : '';
      const [policyResult, logResult] = await Promise.all([api(`/storage/policy${scope}`), api(`/storage${scope}${scope ? '&' : '?'}alertsOnly=${alertsOnly}`)]);
      setPolicy(policyResult.data); setLogs(logResult.data);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }
  useEffect(() => { let active = true; api('/pharmacies').then((result) => { if (active) setPharmacies(result.data || []); }).catch(() => { if (active) setPharmacies([]); }); return () => { active = false; }; }, [user?.id]);
  useEffect(() => { load(); }, [pharmacyId, alertsOnly]);

  async function savePolicy(event) {
    event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget);
    const numeric = (key) => form.get(key) === '' ? null : Number(form.get(key));
    const body = { minTemperatureC: numeric('minTemperatureC'), maxTemperatureC: numeric('maxTemperatureC'), minHumidityPercent: numeric('minHumidityPercent'), maxHumidityPercent: numeric('maxHumidityPercent') };
    if (isAdmin) body.pharmacyId = Number(pharmacyId);
    try { await api('/storage/policy', json('PUT', body)); toast('Storage range policy saved.'); await load(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  async function recordLog(event) {
    event.preventDefault(); setBusy(true); const formElement = event.currentTarget; const form = new FormData(formElement);
    const value = (key) => form.get(key) === '' ? null : Number(form.get(key));
    const body = { temperatureC: value('temperatureC'), humidityPercent: value('humidityPercent'), conditionStatus: form.get('conditionStatus'), conditionNotes: form.get('conditionNotes') || null, notes: form.get('notes') || null };
    if (form.get('batchId')) body.batchId = Number(form.get('batchId'));
    if (isAdmin) body.pharmacyId = Number(pharmacyId);
    try {
      const result = await api('/storage', json('POST', body));
      toast(result.isWithinRange === false ? 'Storage alert recorded. Review this reading.' : result.isWithinRange === null ? 'Reading saved; no matching range was configured.' : 'Storage reading is within configured range.');
      formElement.reset(); await load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  const input = (value) => value == null ? '' : String(value);
  const pharmacyName = pharmacies.find((pharmacy) => Number(pharmacy.id) === Number(pharmacyId))?.name || (pharmacyId ? `Pharmacy ${pharmacyId}` : 'Choose a pharmacy');
  const chartRows = logs.slice(0, 12).filter((row) => row.temperatureC != null || row.humidityPercent != null).reverse().map((row) => ({
    ...row,
    label: new Date(row.recordedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
    temperatureC: row.temperatureC == null ? null : Number(row.temperatureC),
    humidityPercent: row.humidityPercent == null ? null : Number(row.humidityPercent),
  }));
  const hasTemperatureTrend = chartRows.filter((row) => row.temperatureC != null).length >= 2;
  const hasHumidityTrend = chartRows.filter((row) => row.humidityPercent != null).length >= 2;
  return <>
    <PageHeader eyebrow="STORAGE SAFETY" title="Storage monitoring" description="Record temperature, humidity, and condition checks against pharmacy-configured operating ranges." action={<button className="button button-secondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>} />
    <div className="storage-context"><span className="storage-context-icon"><Thermometer size={17} /></span><span><small>MONITORING LOCATION</small><b>{pharmacyName}</b></span>{policy && <span className="storage-policy-summary">{policy.minTemperatureC != null && policy.maxTemperatureC != null ? `${policy.minTemperatureC}–${policy.maxTemperatureC} °C` : 'Temperature not configured'}<i aria-hidden="true">·</i>{policy.minHumidityPercent != null && policy.maxHumidityPercent != null ? `${policy.minHumidityPercent}–${policy.maxHumidityPercent}% RH` : 'Humidity not configured'}</span>}{isAdmin && <Field label="Pharmacy scope"><select value={pharmacyId} onChange={(e) => setPharmacyId(e.target.value)}><option value="">Choose pharmacy</option>{pharmacies.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></Field>}</div>
    {error ? <ErrorState error={error} retry={load} /> : <div className="module-stack">
      {!loading && chartRows.length > 1 && (hasTemperatureTrend || hasHumidityTrend) && <section className="panel storage-trend"><div className="table-toolbar"><div><span className="eyebrow">RECENT OBSERVATIONS</span><h2>Environmental readings</h2><p>Actual recorded checks · most recent {chartRows.length} readings returned · no interpolated points</p></div>{logs[0] && <StatusPill tone={logs[0].isWithinRange === false || logs[0].conditionStatus !== 'normal' ? 'danger' : logs[0].isWithinRange === true ? 'good' : 'neutral'}>{logs[0].isWithinRange === false || logs[0].conditionStatus !== 'normal' ? 'Review required' : logs[0].isWithinRange === true ? 'Within range' : 'Not evaluated'}</StatusPill>}</div><div className="storage-trend-chart" role="img" aria-label="Historical storage temperature and humidity readings"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartRows} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}><CartesianGrid stroke="#ffffff0d" vertical={false} /><XAxis dataKey="label" stroke="#858da3" tickLine={false} axisLine={false} tick={{ fontSize: 9 }} minTickGap={24} /><YAxis hide={!hasTemperatureTrend} yAxisId="temperature" stroke="#b19bff" tickLine={false} axisLine={false} tick={{ fontSize: 9 }} width={42} /><YAxis hide={!hasHumidityTrend} yAxisId="humidity" orientation="right" stroke="#64c7d5" tickLine={false} axisLine={false} tick={{ fontSize: 9 }} width={42} /><Tooltip contentStyle={{ background: '#171a29', border: '1px solid rgba(177,185,221,.16)', borderRadius: 10, color: '#eef0f8' }} labelStyle={{ color: '#c6cadd', fontSize: 10 }} formatter={(value, name) => [name === 'Temperature' ? `${value} °C` : `${value}%`, name]} /><Line hide={!hasTemperatureTrend} yAxisId="temperature" type="monotone" dataKey="temperatureC" name="Temperature" stroke="#b19bff" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls={false} /><Line hide={!hasHumidityTrend} yAxisId="humidity" type="monotone" dataKey="humidityPercent" name="Humidity" stroke="#64c7d5" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls={false} /></LineChart></ResponsiveContainer></div><div className="storage-trend-legend">{hasTemperatureTrend && <span><i className="temp-dot" />Temperature °C</span>}{hasHumidityTrend && <span><i className="humidity-dot" />Humidity %</span>}</div></section>}
      <section className="panel workflow-panel storage-policy"><div className="table-toolbar"><div><h2><Thermometer size={17} /> Storage range policy</h2><p>Configure the limits used to evaluate new readings for this pharmacy.</p></div></div>
        {!policy && pharmacyId && <div className="form-note policy-warning"><AlertTriangle size={14} /> No ranges configured. Readings will be stored but temperature/humidity compliance will show “Not evaluated.”</div>}
        <form key={`${pharmacyId}-${policy?.updatedAt || 'empty'}`} className="form-stack workflow-form" onSubmit={savePolicy}><div className="form-grid">
          <Field label="Minimum temperature (°C)"><input type="number" step="0.01" name="minTemperatureC" defaultValue={input(policy?.minTemperatureC)} /></Field>
          <Field label="Maximum temperature (°C)"><input type="number" step="0.01" name="maxTemperatureC" defaultValue={input(policy?.maxTemperatureC)} /></Field>
          <Field label="Minimum humidity (%)"><input type="number" min="0" max="100" step="0.01" name="minHumidityPercent" defaultValue={input(policy?.minHumidityPercent)} /></Field>
          <Field label="Maximum humidity (%)"><input type="number" min="0" max="100" step="0.01" name="maxHumidityPercent" defaultValue={input(policy?.maxHumidityPercent)} /></Field>
        </div><div className="form-note">Set limits to the approved storage instructions for your stock and location. MediTrack does not prescribe pharmaceutical storage ranges.</div><div className="workflow-actions"><button className="button button-primary" disabled={busy || !pharmacyId}><Save size={15} /> Save ranges</button></div></form>
      </section>
      <section className="panel workflow-panel storage-capture"><div className="table-toolbar"><div><h2><ClipboardCheck size={17} /> Record storage check</h2><p>Out-of-range readings and non-normal conditions are flagged in the log.</p></div></div>
        <form className="form-stack workflow-form" onSubmit={recordLog}><div className="form-grid">
          <Field label="Temperature (°C)"><input type="number" step="0.01" name="temperatureC" placeholder="e.g. 5.2" /></Field>
          <Field label="Humidity (%)"><input type="number" min="0" max="100" step="0.01" name="humidityPercent" placeholder="Optional" /></Field>
          <Field label="Storage condition"><select name="conditionStatus" defaultValue="normal"><option value="normal">Normal</option><option value="damaged_packaging">Damaged packaging</option><option value="contamination">Possible contamination</option><option value="power_outage">Power outage</option><option value="other">Other condition</option></select></Field>
          <Field label="Condition notes"><input name="conditionNotes" maxLength="500" placeholder="Required for a non-normal condition" /></Field>
          <Field label="Reading notes"><input name="notes" maxLength="500" placeholder="Optional location or handling notes" /></Field>
        </div><div className="workflow-actions"><button className="button button-primary" disabled={busy || !pharmacyId}><ClipboardCheck size={15} /> {busy ? 'Saving…' : 'Record check'}</button></div></form>
      </section>
      <section className="panel table-panel module-table storage-history"><div className="table-toolbar"><div><h2>Storage log</h2><p>{alertsOnly ? 'Readings that need review' : 'Latest readings and condition checks'}</p></div><button type="button" className={`button button-small ${alertsOnly ? 'button-primary' : 'button-secondary'}`} onClick={() => setAlertsOnly((value) => !value)}><AlertTriangle size={13} /> {alertsOnly ? 'Show all readings' : 'Alerts only'}</button></div>
        {loading ? <TableSkeleton rows={5} cols={5} /> : logs.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>RECORDED</th><th>READING</th><th>CONDITION</th><th>RECORDED BY</th><th>STATUS</th></tr></thead><tbody>{logs.map((row) => <tr key={row.id}><td>{new Date(row.recordedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>{row.temperatureC == null ? '—' : `${row.temperatureC} °C`} · {row.humidityPercent == null ? '—' : `${row.humidityPercent}%`}{row.batchNumber && <small className="unit-label">{row.batchNumber}</small>}</td><td><div className="stacked-cell"><b>{(row.conditionStatus || 'normal').replaceAll('_', ' ')}</b><small>{row.conditionNotes || row.notes || 'No additional notes'}</small></div></td><td>{row.recordedByName || 'Former staff'}</td><td>{row.isWithinRange === false || (row.conditionStatus && row.conditionStatus !== 'normal') ? <StatusPill tone="danger">Review</StatusPill> : row.isWithinRange === true ? <StatusPill tone="good"><Check size={12} /> Within range</StatusPill> : <StatusPill tone="neutral">Not evaluated</StatusPill>}</td></tr>)}</tbody></table></div> : <EmptyState icon={ClipboardCheck} title={alertsOnly ? 'No storage alerts' : 'No storage readings'} text={alertsOnly ? 'No readings are currently marked for review.' : 'Recorded temperature and condition checks will appear here.'} />}
      </section>
    </div>}
  </>;
}
