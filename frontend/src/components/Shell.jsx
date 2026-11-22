import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Bell, Boxes, ChartNoAxesCombined, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, LayoutDashboard, LogOut, Menu, Pill, ShieldPlus, ShoppingCart, Thermometer, TrendingUp, Truck, UserRoundCog, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { useToast } from './Toast';
import { api } from '../api';
import { getWorkspaceName } from '../workspaceName';

const links = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, section: 'Workspace' },
  { to: '/medicines', label: 'Medicines', icon: Pill },
  { to: '/inventory', label: 'Inventory', icon: Boxes },
  { to: '/reconciliation', label: 'Inventory reconciliation', icon: ClipboardCheck },
  { to: '/sales', label: 'Point of sale', icon: ShoppingCart },
  { to: '/suppliers', label: 'Suppliers', icon: Truck },
  { to: '/transfers', label: 'Stock transfers', icon: ArrowLeftRight },
  { to: '/alerts', label: 'Safety alerts', icon: Bell, section: 'Operations' },
  { to: '/storage', label: 'Storage monitoring', icon: Thermometer },
  { to: '/forecasts', label: 'Demand forecasts', icon: TrendingUp },
  { to: '/reports', label: 'Reports', icon: ChartNoAxesCombined },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/staff', label: 'Staff & roles', icon: UserRoundCog, roles: ['platform_admin', 'pharmacy_manager'], section: 'Administration' },
  { to: '/audit', label: 'Audit trail', icon: ClipboardList, roles: ['platform_admin', 'pharmacy_manager'] },
];

export default function Shell() {
  const { user, logout, apiConnected } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [pharmacies, setPharmacies] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(null);
  const location = useLocation();
  const title = links.find((link) => link.to === location.pathname)?.label || 'Workspace';
  const visibleLinks = links.filter((link) => !link.roles || link.roles.includes(user?.role));
  const initials = user?.fullName?.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);
  useEffect(() => {
    let current = true;
    if (!user?.pharmacyId) { setPharmacies([]); return () => { current = false; }; }
    api('/pharmacies').then((result) => { if (current) setPharmacies(result.data || []); }).catch(() => { if (current) setPharmacies([]); });
    return () => { current = false; };
  }, [user?.pharmacyId]);
  const workspaceName = getWorkspaceName(user, pharmacies);
  useEffect(() => {
    let current = true;
    const refreshUnread = () => api('/notifications/refresh', { method: 'POST' })
      .then((result) => { if (current) setUnreadNotifications(Number(result.count) || 0); })
      .catch(() => { if (current) setUnreadNotifications(null); });
    refreshUnread();
    const timer = window.setInterval(refreshUnread, 60000);
    window.addEventListener('meditrack:notifications-changed', refreshUnread);
    return () => { current = false; window.clearInterval(timer); window.removeEventListener('meditrack:notifications-changed', refreshUnread); };
  }, [user?.id, location.pathname]);
  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      setMobileOpen(false);
      navigate('/login', { replace: true });
    } catch (_error) {
      toast('Could not sign out. Check your connection and try again.', 'error');
    } finally { setLoggingOut(false); }
  }
  const sidebar = <>
    <div className="brand"><div className="brand-mark"><ShieldPlus size={21} strokeWidth={2.3} /></div><div><strong>MediTrack</strong><span>Inventory intelligence</span></div><button type="button" aria-label="Close navigation" className="mobile-close icon-button" onClick={() => setMobileOpen(false)}><X size={18} /></button></div>
    <div className="workspace-chip"><div className="workspace-symbol">{user?.pharmacyId ? 'PH' : 'MT'}</div><div><b>{workspaceName}</b><small>Operational view</small></div></div>
    <nav aria-label="Main navigation" className="side-nav">{visibleLinks.map((link) => <div key={link.to}>{link.section && <div className="nav-section">{link.section}</div>}<NavLink end={link.to === '/'} title={collapsed ? link.label : undefined} aria-label={link.label} onClick={() => setMobileOpen(false)} to={link.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><link.icon size={18} strokeWidth={1.85} /><span>{link.label}</span></NavLink></div>)}</nav>
    <div className="sidebar-bottom"><div className="user-card"><div className="avatar">{initials}</div><div className="user-meta"><b>{user?.fullName}</b><small>{String(user?.role || '').replaceAll('_', ' ')}</small></div><button className="button button-secondary logout-button" type="button" onClick={handleLogout} disabled={loggingOut} aria-busy={loggingOut}><LogOut size={15} /><span>{loggingOut ? 'Signing out…' : 'Log out'}</span></button></div></div>
  </>;
  return <div className="app-shell"><aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'open' : ''}`}>{sidebar}</aside>{mobileOpen && <div className="mobile-overlay" onClick={() => setMobileOpen(false)} />}<main className={`main-area ${collapsed ? 'sidebar-collapsed' : ''}`}><header className="topbar"><div className="topbar-left"><button aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={collapsed} className="desktop-sidebar-toggle icon-button" onClick={() => setCollapsed((value) => !value)} title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>{collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button><button aria-label="Open navigation" aria-expanded={mobileOpen} className="mobile-menu icon-button" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div className="breadcrumbs"><span className="breadcrumb-root">Workspace</span><span className="breadcrumb-separator">/</span><b>{title}</b></div></div><div className="topbar-actions"><div className="date-badge"><span className={`online-dot ${apiConnected ? '' : 'offline-dot'}`} /> {apiConnected ? 'API connected' : 'API offline'}</div><NavLink to="/notifications" className="top-icon notification-button notification-link" aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ''}`} title="Notifications"><Bell size={18} />{unreadNotifications > 0 && <span className="notification-count">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</NavLink><div className="top-divider" /><div className="top-user"><div className="avatar small-avatar">{initials}</div><div><b>{user?.fullName?.split(' ')[0]}</b><small title={workspaceName}>{workspaceName}</small></div></div></div></header><div className="page-content"><Outlet /></div><footer className="app-footer"><span>© 2026 MediTrack Health Systems</span><span><span className={`online-dot ${apiConnected ? '' : 'offline-dot'}`} /> {apiConnected ? 'API reachable' : 'API unavailable'}</span></footer></main></div>;
}
