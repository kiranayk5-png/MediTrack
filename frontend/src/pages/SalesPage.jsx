import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Barcode, Camera, Check, CircleAlert, Minus, Plus, ScanLine, Search, ShoppingBag, Trash2, X } from 'lucide-react';
import { api, json } from '../api';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, Field, Modal, PageHeader, SearchBox, Spinner, StatusPill, TableSkeleton } from '../components/UI';
import { useAuth } from '../auth';
import { buildSalePayload, checkoutValidationMessage } from '../salePayload';

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

function CameraScanner({ onDetected, onClose }) {
  const videoRef = useRef(null); const controlsRef = useRef(null); const [error, setError] = useState('');
  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
      if (result) { controlsRef.current?.stop(); onDetected(result.getText()); }
    }).then((controls) => { controlsRef.current = controls; }).catch(() => setError('Camera could not start. Check browser permission or enter the barcode manually.'));
    return () => controlsRef.current?.stop();
  }, []);
  return <Modal title="Scan medicine barcode" onClose={onClose}><div className="scanner-frame"><video ref={videoRef} muted playsInline />{error && <div className="scanner-error"><CircleAlert size={19} />{error}</div>}{!error && <div className="scan-target"><span /></div>}</div><p className="scanner-disclaimer"><CircleAlert size={15} /> A barcode lookup identifies a stored catalogue entry only. It does not authenticate a genuine medicine.</p></Modal>;
}

export default function SalesPage() {
  const toast = useToast(); const { user } = useAuth(); const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [search, setSearch] = useState(''); const [matches, setMatches] = useState([]); const [searchBusy, setSearchBusy] = useState(false); const [lookupBusy, setLookupBusy] = useState(false); const [barcode, setBarcode] = useState(''); const [cart, setCart] = useState([]); const [busy, setBusy] = useState(false); const [scanner, setScanner] = useState(false); const [discount, setDiscount] = useState('0');
  const [targetPharmacy, setTargetPharmacy] = useState(''); const [pharmacies, setPharmacies] = useState([]); const [pharmaciesLoading, setPharmaciesLoading] = useState(true); const [pharmaciesError, setPharmaciesError] = useState(null); const [pharmacySearch, setPharmacySearch] = useState(''); const [pharmacyPickerOpen, setPharmacyPickerOpen] = useState(false); const [confirmSale, setConfirmSale] = useState(false); const [checkoutError, setCheckoutError] = useState('');
  const isPlatformAdmin = user?.role === 'platform_admin';
  const selectedPharmacy = pharmacies.find((pharmacy) => String(pharmacy.id) === targetPharmacy);
  const visiblePharmacies = pharmacies.filter((pharmacy) => `${pharmacy.name} ${pharmacy.city || ''} ${pharmacy.state || ''}`.toLowerCase().includes(pharmacySearch.toLowerCase()));
  async function loadSales() { setLoading(true); setError(null); try { setRows((await api('/sales?limit=30')).data); } catch (e) { setError(e); } finally { setLoading(false); } }
  async function loadPharmacies() {
    setPharmaciesLoading(true); setPharmaciesError(null);
    try {
      const result = await api('/pharmacies');
      setPharmacies(result.data);
      if (!isPlatformAdmin && user?.pharmacyId) setTargetPharmacy(String(user.pharmacyId));
    } catch (e) { setPharmaciesError(e); }
    finally { setPharmaciesLoading(false); }
  }
  useEffect(() => { loadSales(); loadPharmacies(); }, []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (!search.trim()) { setMatches([]); setSearchBusy(false); return; }
      setSearchBusy(true);
      try { const result = await api(`/medicines?search=${encodeURIComponent(search)}&limit=8`); if (active) setMatches(result.data); }
      catch { if (active) setMatches([]); }
      finally { if (active) setSearchBusy(false); }
    }, 220);
    return () => { active = false; clearTimeout(timer); };
  }, [search]);
  function add(medicine) { setCart((current) => { const found = current.find((line) => line.medicineId === medicine.id); return found ? current.map((line) => line.medicineId === medicine.id ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { medicineId: medicine.id, name: medicine.name, strength: medicine.strength, quantity: 1 }]; }); setSearch(''); setMatches([]); }
  function updateQuantity(id, quantity) { setCart((current) => current.map((line) => line.medicineId === id ? { ...line, quantity: Math.max(1, quantity) } : line)); }
  async function lookup(value = barcode) {
    if (!value.trim()) return; setLookupBusy(true);
    try { const pharmacyQuery = isPlatformAdmin && targetPharmacy ? `?pharmacyId=${encodeURIComponent(targetPharmacy)}` : ''; const result = await api(`/lookup/barcode/${encodeURIComponent(value.trim())}${pharmacyQuery}`); const medicine = result.data[0]; add({ id: medicine.medicineId, name: medicine.name, strength: medicine.strength }); setBarcode(''); toast('Catalogue match added. Barcode does not verify product authenticity.', 'success'); }
    catch (e) { toast(e.message, 'error'); } finally { setLookupBusy(false); }
  }
  async function checkout() {
    if (!cart.length) return; setBusy(true);
    setCheckoutError('');
    try { const payload = buildSalePayload({ role: user?.role, pharmacyId: targetPharmacy, cart, discount }); const result = await api('/sales', json('POST', payload)); toast(`Sale ${result.receiptNumber} recorded for ${money.format(result.totalAmount)}.`); setCart([]); setDiscount('0'); setConfirmSale(false); loadSales(); }
    catch (e) { if (e.code === 'VALIDATION_ERROR') setCheckoutError(checkoutValidationMessage(e)); else toast(checkoutValidationMessage(e), 'error'); } finally { setBusy(false); }
  }
  function selectPharmacy(pharmacy) {
    if (targetPharmacy && targetPharmacy !== String(pharmacy.id) && cart.length) {
      setCart([]);
      toast('Basket cleared because the pharmacy changed.');
    }
    setTargetPharmacy(String(pharmacy.id));
    setPharmacySearch('');
    setPharmacyPickerOpen(false);
  }
  return <>
    <PageHeader eyebrow="DISPENSING WORKSPACE" title="Point of sale" description="Look up products, build a basket and let FEFO allocate eligible batches." action={<div className="sales-live"><span className="online-dot" /> Transaction-safe checkout</div>} />
    <div className="sales-layout"><section className="panel sales-catalog"><div className="panel-heading"><div><div className="eyebrow">CATALOGUE LOOKUP</div><h2>Build a sale</h2><p>Search by product or scan a saved barcode identifier.</p></div><div className="tiny-icon"><ShoppingBag size={17} /></div></div><div className="field pharmacy-scope-field"><label htmlFor="sale-pharmacy">{isPlatformAdmin ? 'Sale pharmacy' : 'Assigned pharmacy'}</label>{isPlatformAdmin ? <div className="pharmacy-picker"><input id="sale-pharmacy" type="search" role="combobox" aria-autocomplete="list" aria-expanded={pharmacyPickerOpen} aria-controls="sale-pharmacy-options" aria-label="Search and select a sale pharmacy" autoComplete="off" value={pharmacyPickerOpen ? pharmacySearch : (selectedPharmacy?.name || '')} placeholder={pharmaciesLoading ? 'Loading pharmacies…' : 'Search pharmacies by name or city'} disabled={pharmaciesLoading || Boolean(pharmaciesError)} onFocus={() => { setPharmacySearch(''); setPharmacyPickerOpen(true); }} onBlur={() => window.setTimeout(() => setPharmacyPickerOpen(false), 120)} onChange={(event) => { setPharmacySearch(event.target.value); setPharmacyPickerOpen(true); }} onKeyDown={(event) => { if (event.key === 'Escape') setPharmacyPickerOpen(false); if (event.key === 'Enter' && visiblePharmacies[0]) { event.preventDefault(); selectPharmacy(visiblePharmacies[0]); } }} />{pharmacyPickerOpen && <div className="pharmacy-options" id="sale-pharmacy-options" role="listbox" aria-label="Available pharmacies">{visiblePharmacies.length ? visiblePharmacies.map((pharmacy) => <button type="button" role="option" aria-selected={String(pharmacy.id) === targetPharmacy} key={pharmacy.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectPharmacy(pharmacy)}><b>{pharmacy.name}</b><small>{[pharmacy.city, pharmacy.state].filter(Boolean).join(', ') || 'Location details not set'}</small></button>) : <div className="pharmacy-no-results">{pharmacies.length ? 'No pharmacies match this search.' : 'No active pharmacies are available.'}</div>}</div>}</div> : <input id="sale-pharmacy" value={selectedPharmacy ? `${selectedPharmacy.name}${selectedPharmacy.city ? ` · ${selectedPharmacy.city}` : ''}` : (pharmaciesLoading ? 'Loading assigned pharmacy…' : 'No assigned pharmacy')} readOnly aria-readonly="true" />}{pharmaciesLoading && <small role="status">Loading pharmacy access…</small>}{pharmaciesError && <div className="pharmacy-load-error" role="alert"><span>{pharmaciesError.message}</span><button type="button" className="button button-small button-secondary" onClick={loadPharmacies}>Retry</button></div>}</div><div className="barcode-row"><div className="barcode-input"><Barcode size={17} /><input aria-label="Medicine barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} placeholder="Enter or scan barcode" /></div><button className="button button-secondary" disabled={lookupBusy || pharmaciesLoading || !targetPharmacy} onClick={() => lookup()}>{lookupBusy ? 'Searching…' : 'Find barcode'}</button><button className="button button-secondary scan-button" title="Use camera scanner" aria-label="Open barcode camera scanner" disabled={pharmaciesLoading || !targetPharmacy} onClick={() => setScanner(true)}><Camera size={17} /></button></div><div className="catalog-search"><SearchBox value={search} onChange={setSearch} placeholder="Search medicine name..." /></div>{searchBusy && <div className="sales-search-feedback" role="status"><Spinner label="Searching medicines" /></div>}{!searchBusy && search.trim() && matches.length === 0 && <div className="sales-search-empty" role="status">No catalogue matches for “{search.trim()}”. Try a different name or use the barcode field.</div>}{matches.length > 0 && <div className="search-results" role="listbox" aria-label="Medicine search results">{matches.map((medicine) => <button type="button" role="option" aria-selected="false" key={medicine.id} className="search-result" onClick={() => add(medicine)}><div className="medicine-mark"><span>{medicine.name.slice(0, 1)}</span></div><div><b>{medicine.name}</b><small>{medicine.strength || 'Strength not listed'} · {medicine.dosageForm || 'Form not listed'}</small></div><Plus size={17} /></button>)}</div>}<div className="catalog-note"><CircleAlert size={15} /><span>Sale will use earliest-expiring stock that is in date and not under an active recall.</span></div><div className="safety-note"><span className="note-icon"><Check size={15} /></span><div><b>Safety checks at checkout</b><p>Expired, recalled and unavailable batches are excluded. Stock decrements are committed with the sale record.</p></div></div></section>
      <section className="panel cart-panel"><div className="cart-head"><div><div className="eyebrow">CURRENT TRANSACTION</div><h2>Sale basket <span>{cart.length}</span></h2></div><div className="receipt-mark">MT</div></div><div className="cart-lines">{cart.length ? cart.map((line) => <div className="cart-line" key={line.medicineId}><div className="cart-product"><div className="medicine-mark"><span>{line.name.slice(0, 1)}</span></div><div><b>{line.name}</b><small>{line.strength || 'Formulation'}</small></div></div><div className="cart-qty"><button aria-label={`Decrease ${line.name} quantity`} onClick={() => line.quantity > 1 ? updateQuantity(line.medicineId, line.quantity - 1) : setCart(cart.filter((item) => item.medicineId !== line.medicineId))}><Minus size={13} /></button><span aria-live="polite">{line.quantity}</span><button aria-label={`Increase ${line.name} quantity`} onClick={() => updateQuantity(line.medicineId, line.quantity + 1)}><Plus size={13} /></button></div><button className="icon-button remove-line" title={`Remove ${line.name}`} aria-label={`Remove ${line.name} from basket`} onClick={() => setCart(cart.filter((item) => item.medicineId !== line.medicineId))}><Trash2 size={15} /></button></div>) : <EmptyState icon={ShoppingBag} title="Basket is clear" text="Search or scan to add medicine to this transaction." />}</div>{cart.length > 0 && <><div className="cart-summary"><label>Discount <div className="discount-field"><span>₹</span><input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div></label><p><span>Pricing</span><b>Calculated from allocated batches</b></p><p><span>Expiry & recall checks</span><StatusPill tone="good">Enabled</StatusPill></p><div className="total-estimate"><span>Total</span><b>Calculated at checkout</b></div></div><button className="button button-primary checkout-button" disabled={busy || pharmaciesLoading || !targetPharmacy} onClick={() => setConfirmSale(true)}>Review and complete sale <ShoppingBag size={16} /></button><small className="checkout-caption">Final pricing is resolved server-side from batch selling prices.</small></>}</section></div>
    <section className="panel table-panel recent-sales"><div className="table-toolbar"><div><h2>Recent transactions</h2><p>Latest sales recorded in this pharmacy scope</p></div><div className="sales-counter"><ShoppingBag size={16} />{rows.length} recent</div></div>{loading ? <TableSkeleton rows={4} cols={5} /> : error ? <ErrorState error={error} retry={loadSales} /> : rows.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>RECEIPT</th><th>TIME</th><th>CASHIER</th><th>ITEM LINES</th><th>TOTAL</th><th>STATUS</th></tr></thead><tbody>{rows.map((sale) => <tr key={sale.id}><td><b>{sale.receiptNumber}</b></td><td>{new Date(sale.soldAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>{sale.cashierName}</td><td>{sale.lineCount}</td><td><b>{money.format(sale.totalAmount)}</b></td><td><StatusPill tone={sale.status === 'completed' ? 'good' : 'neutral'}>{sale.status}</StatusPill></td></tr>)}</tbody></table></div> : <EmptyState icon={ShoppingBag} title="No sales recorded" text="Completed transactions will appear here." />}</section>
    {scanner && <CameraScanner onClose={() => setScanner(false)} onDetected={(value) => { setScanner(false); setBarcode(value); lookup(value); }} />}
    {confirmSale && <Modal title="Confirm sale" onClose={() => { setCheckoutError(''); setConfirmSale(false); }}><div className="confirm-copy"><div className="confirm-icon"><ShoppingBag size={18} /></div><p>Complete this sale for <b>{cart.reduce((sum, item) => sum + item.quantity, 0)} units</b> across <b>{cart.length} medicine{cart.length === 1 ? '' : 's'}</b>?</p><p>Eligible batches and final prices will be checked again and committed atomically.</p></div>{checkoutError && <div className="checkout-validation" role="alert">{checkoutError}</div>}<div className="modal-actions"><button className="button button-secondary" onClick={() => { setCheckoutError(''); setConfirmSale(false); }}>Review basket</button><button className="button button-primary" disabled={busy} onClick={checkout}>{busy ? 'Processing…' : 'Confirm sale'}</button></div></Modal>}
  </>;
}
