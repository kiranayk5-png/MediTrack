import { createContext, useContext, useState } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';

const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  function toast(message, type = 'success') {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, message, type }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4200);
  }
  return <ToastContext.Provider value={toast}>{children}<div className="toast-stack" aria-live="polite" aria-relevant="additions text">{items.map((item) => <div className={`toast ${item.type}`} role={item.type === 'error' ? 'alert' : 'status'} key={item.id}>{item.type === 'error' ? <XCircle aria-hidden="true" size={18} /> : <CheckCircle2 aria-hidden="true" size={18} />}<span>{item.message}</span><button type="button" className="icon-button" aria-label="Dismiss notification" onClick={() => setItems((current) => current.filter((v) => v.id !== item.id))}><X size={15} /></button></div>)}</div></ToastContext.Provider>;
}
export const useToast = () => useContext(ToastContext);
