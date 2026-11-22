import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Fingerprint, LockKeyhole, Pill, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';

export default function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true);
    try { await login(email, password); }
    catch (error) { toast(error.message, 'error'); }
    finally { setBusy(false); }
  }
  return <div className="login-page"><div className="login-visual"><div className="visual-orb orb-one" /><div className="visual-orb orb-two" /><div className="visual-grid" /><div className="login-brand"><div className="brand-mark"><Pill size={21} /></div><span>MediTrack</span></div><div className="visual-copy"><div className="visual-label"><span className="online-dot" /> INTELLIGENT PHARMACEUTICAL OPERATIONS</div><h1>Every batch.<br /><span>In safe hands.</span></h1><p>A single source of truth for inventory, dispensing and pharmaceutical safety.</p><div className="visual-stat-row"><div><b>Batch level</b><span>visibility</span></div><div><b>FEFO</b><span>dispensing logic</span></div><div><b>Live</b><span>stock awareness</span></div></div></div><div className="login-visual-footer"><span><ShieldCheck size={15} /> Safety-led inventory</span><span>BUILT FOR PHARMACY TEAMS</span></div></div><div className="login-panel"><div className="login-form-wrap"><div className="mobile-login-brand"><div className="brand-mark"><Pill size={18} /></div><b>MediTrack</b></div><div className="login-kicker">WELCOME BACK</div><h2>Sign in to your workspace</h2><p className="login-subtitle">Use your pharmacy account to continue.</p><form onSubmit={submit} className="login-form"><label className="field"><span>Work email</span><div className="input-icon"><Fingerprint aria-hidden="true" size={17} /><input aria-label="Work email" autoComplete="username" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@pharmacy.com" /></div></label><label className="field"><span>Password</span><div className="input-icon has-password-toggle"><LockKeyhole aria-hidden="true" size={17} /><input aria-label="Password" autoComplete="current-password" required type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" /><button type="button" className="icon-button password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label><div className="login-options"><span className="login-session-note"><ShieldCheck size={13} /> Role-based access for your pharmacy</span><span>Secure session</span></div><button className="button button-primary login-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} {!busy && <ArrowRight size={17} />}</button></form><div className="login-security"><ShieldCheck size={17} /><span>Protected with encrypted, HttpOnly session cookies</span></div><div className="login-help">Need access? <span>Ask your pharmacy administrator.</span></div></div><div className="login-footer">© 2026 MediTrack Health Systems <span>Privacy · Security</span></div></div></div>;
}
