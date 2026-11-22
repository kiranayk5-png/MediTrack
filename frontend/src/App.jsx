import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Spinner } from './components/UI';
import Shell from './components/Shell';
import { canAccessManagementRoutes } from './routeAccess';
const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const MedicinesPage = lazy(() => import('./pages/MedicinesPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'));
const SalesPage = lazy(() => import('./pages/SalesPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const TransfersPage = lazy(() => import('./pages/TransfersPage'));
const StaffPage = lazy(() => import('./pages/StaffPage'));
const StoragePage = lazy(() => import('./pages/StoragePage'));
const ForecastsPage = lazy(() => import('./pages/ForecastsPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const InventoryReconciliationPage = lazy(() => import('./pages/InventoryReconciliationPage'));

function PageFallback() { return <div className="app-loading"><Spinner label="Opening workspace" /></div>; }

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading"><Spinner label="Preparing workspace" /></div>;
  return user ? <Shell /> : <Navigate to="/login" replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading"><Spinner label="Preparing workspace" /></div>;
  return <Suspense fallback={<PageFallback />}><Routes>
    <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
    <Route element={<Protected />}>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/medicines" element={<MedicinesPage />} />
      <Route path="/inventory" element={<InventoryPage />} />
      <Route path="/reconciliation" element={<InventoryReconciliationPage />} />
      <Route path="/suppliers" element={<SuppliersPage />} />
      <Route path="/sales" element={<SalesPage />} />
      <Route path="/alerts" element={<AlertsPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/transfers" element={<TransfersPage />} />
      <Route path="/storage" element={<StoragePage />} />
      <Route path="/forecasts" element={<ForecastsPage />} />
      <Route path="/staff" element={canAccessManagementRoutes(user?.role) ? <StaffPage /> : <Navigate to="/" replace />} />
      <Route path="/audit" element={canAccessManagementRoutes(user?.role) ? <AuditPage /> : <Navigate to="/" replace />} />
      <Route path="/notifications" element={<NotificationsPage />} />
    </Route>
    <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
  </Routes></Suspense>;
}
