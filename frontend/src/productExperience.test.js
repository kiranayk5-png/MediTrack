import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dashboard analytics and alert context are loaded from pharmacy-scoped APIs', async () => {
  const dashboard = await readFile(new URL('./pages/DashboardPage.jsx', import.meta.url), 'utf8');
  assert.match(dashboard, /api\('\/dashboard'\)/);
  assert.match(dashboard, /api\('\/notifications\/unread-count'\)/);
  assert.match(dashboard, /data\?\.salesTrend/);
  assert.match(dashboard, /data\?\.stockByMedicine/);
  assert.match(dashboard, /data\?\.stockStatusDistribution/);
  assert.match(dashboard, /does not return mutually exclusive batch-status totals/);
  assert.doesNotMatch(dashboard, /mockData|sampleMetrics|fakeMetrics/i);
});

test('shared modal and toast components expose accessible keyboard and announcement behavior', async () => {
  const ui = await readFile(new URL('./components/UI.jsx', import.meta.url), 'utf8');
  const toast = await readFile(new URL('./components/Toast.jsx', import.meta.url), 'utf8');
  assert.match(ui, /role="dialog" aria-modal="true" aria-labelledby=/);
  assert.match(ui, /event\.key === 'Escape'/);
  assert.match(ui, /event\.shiftKey/);
  assert.match(ui, /aria-label=\{placeholder\}/);
  assert.match(toast, /role=\{item\.type === 'error' \? 'alert' : 'status'\}/);
  assert.match(toast, /aria-label="Dismiss notification"/);
});

test('medicines, inventory and checkout retain live API workflows and accessible controls', async () => {
  const medicines = await readFile(new URL('./pages/MedicinesPage.jsx', import.meta.url), 'utf8');
  const inventory = await readFile(new URL('./pages/InventoryPage.jsx', import.meta.url), 'utf8');
  const sales = await readFile(new URL('./pages/SalesPage.jsx', import.meta.url), 'utf8');
  assert.match(medicines, /api\(`\/medicines\?page=/);
  assert.match(medicines, /aria-sort=/);
  assert.match(medicines, /\/medicines\/\$\{modal\.id\}\/batches/);
  assert.match(inventory, /api\(`\/inventory\?page=/);
  assert.match(inventory, /\/inventory\/\$\{row\.batchId\}\/history/);
  assert.match(inventory, /navigate\('\/reconciliation'/);
  assert.match(sales, /api\('\/sales', json\('POST', payload\)\)/);
  assert.match(sales, /buildSalePayload/);
  assert.match(sales, /FEFO allocate eligible batches/);
  assert.match(sales, /No catalogue matches/);
  assert.doesNotMatch(sales, /estimatedPrice|mockSale|fakeInventory/i);
});

test('remaining modules retain their live API sources and permission-aware workflows', async () => {
  const [suppliers, transfers, storage, alerts, forecasts, reports, staff, audit, notifications, reconciliation] = await Promise.all([
    'SuppliersPage.jsx', 'TransfersPage.jsx', 'StoragePage.jsx', 'AlertsPage.jsx', 'ForecastsPage.jsx',
    'ReportsPage.jsx', 'StaffPage.jsx', 'AuditPage.jsx', 'NotificationsPage.jsx', 'InventoryReconciliationPage.jsx',
  ].map((file) => readFile(new URL(`./pages/${file}`, import.meta.url), 'utf8')));
  assert.match(suppliers, /api\('\/suppliers'\)/);
  assert.match(suppliers, /api\('\/pharmacies'\)/);
  assert.match(transfers, /api\('\/transfers'\)/);
  assert.match(transfers, /access\.destination && \['requested','approved'\]/);
  assert.match(transfers, /\/transfers\/\$\{rejectingTransfer\.id\}\/reject/);
  assert.match(transfers, /function TransferTimeline/);
  assert.match(storage, /api\(`\/storage\$\{scope\}/);
  assert.match(storage, /logs\.slice\(0, 12\)/);
  assert.match(storage, /chartRows\.length > 1 && \(hasTemperatureTrend \|\| hasHumidityTrend\)/);
  assert.match(storage, /<YAxis hide=\{!hasTemperatureTrend\}/);
  assert.match(storage, /hasHumidityTrend && <span><i className="humidity-dot"/);
  assert.doesNotMatch(storage, /sampleReadings|mockTemperature|fakeHumidity/i);
  assert.match(alerts, /api\('\/alerts'\)/);
  assert.match(forecasts, /api\(`\/forecasts/);
  assert.match(forecasts, /canGenerate = \['platform_admin', 'pharmacy_manager'\]/);
  assert.match(forecasts, /layout="vertical"/);
  assert.match(forecasts, /maxBarSize=\{22\}/);
  assert.match(forecasts, /function ForecastChartTooltip/);
  assert.match(forecasts, /<details className="forecast-explanation">/);
  assert.match(forecasts, /Review historical coverage/);
  assert.match(forecasts, /No forecasts generated/);
  assert.doesNotMatch(forecasts, /confidence score|forecast accuracy/i);
  assert.match(reports, /api\(`\/reports\/\$\{tab\}\?format=csv`/);
  assert.match(reports, /role="tablist"/);
  assert.match(staff, /api\('\/staff\/roles'\)/);
  assert.match(staff, /<Modal title=\{editing \? 'Edit staff account'/);
  assert.match(audit, /api\(`\/audit\?/);
  assert.match(audit, /className="audit-details" title=\{details\}/);
  assert.match(notifications, /listNotifications\(/);
  assert.match(reconciliation, /canReviewReconciliation\(user, detail\)/);
  assert.match(reconciliation, /You cannot approve your own count/);
});
