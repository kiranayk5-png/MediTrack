import { useEffect, useId, useRef } from 'react';
import { LoaderCircle, Search, X } from 'lucide-react';

export function Spinner({ label = 'Loading' }) { return <div className="spinner-wrap" role="status"><LoaderCircle aria-hidden="true" className="spin" size={22} /><span>{label}</span></div>; }
export function PageHeader({ eyebrow, title, description, action }) { return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="header-action">{action}</div>}</div>; }
export function EmptyState({ icon: Icon, title, text, action }) { return <div className="empty-state">{Icon && <div className="empty-icon"><Icon size={22} /></div>}<h3>{title}</h3><p>{text}</p>{action}</div>; }
export function ErrorState({ error, retry }) { return <div className="error-state"><div><strong>We couldn’t load this data</strong><p>{error?.message || 'Check your connection and try again.'}</p></div>{retry && <button className="button button-secondary" onClick={retry}>Try again</button>}</div>; }
export function SearchBox({ value, onChange, placeholder = 'Search records...' }) { return <label className="search-box"><Search aria-hidden="true" size={17} /><input aria-label={placeholder} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>; }
export function Modal({ title, onClose, children, wide = false }) {
  const titleId = useId(); const dialogRef = useRef(null); const closeRef = useRef(null); const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape') { event.stopPropagation(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) { event.preventDefault(); dialogRef.current.focus(); return; }
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section ref={dialogRef} tabIndex={-1} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="modal-head"><div><div className="eyebrow">MediTrack workspace</div><h2 id={titleId}>{title}</h2></div><button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></div>{children}</section></div>;
}
export function Field({ label, children, hint }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function StatusPill({ children, tone = 'neutral' }) { return <span className={`status-pill ${tone}`}>{children}</span>; }
export function TableSkeleton({ rows = 5, cols = 5 }) { return <div className="table-skeleton" role="presentation" aria-hidden="true">{Array.from({ length: rows }, (_, row) => <div className="skeleton-row" key={row}>{Array.from({ length: cols }, (_, col) => <span key={col} />)}</div>)}</div>; }
export function Pagination({ page, pages, onChange }) { if (pages < 2) return null; return <div className="pagination"><span>Page {page} of {pages}</span><div><button className="button button-small button-secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button><button className="button button-small button-secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button></div></div>; }
