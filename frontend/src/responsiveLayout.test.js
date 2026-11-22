import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [shell, transfers, reports, routerEntry, styles] = await Promise.all([
  readFile(new URL('./components/Shell.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./pages/TransfersPage.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./pages/ReportsPage.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./main.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./styles.css', import.meta.url), 'utf8'),
]);

test('mobile navigation closes on Escape and after selecting an authorized route', () => {
  assert.match(shell, /event\.key === 'Escape'\) setMobileOpen\(false\)/);
  assert.match(shell, /onClick=\{\(\) => setMobileOpen\(false\)\} to=\{link\.to\}/);
  assert.match(shell, /aria-expanded=\{mobileOpen\}/);
  assert.match(shell, /roles: \['platform_admin', 'pharmacy_manager'\]/);
});

test('stock transfers have a full-detail mobile card layout and retain the same scoped actions', () => {
  assert.match(transfers, /className="[^"]*transfer-desktop-table"/);
  assert.match(transfers, /className="transfer-mobile-list"/);
  assert.match(transfers, /<b>\{transfer\.sourcePharmacy\}<\/b>/);
  assert.match(transfers, /<b>\{transfer\.destinationPharmacy\}<\/b>/);
  assert.match(transfers, /actionsFor\(transfer, user\)/);
  assert.match(transfers, /<TransferActions access=\{access\}/);
  assert.match(transfers, /api\('\/transfers'\)/);
  assert.match(styles, /@media \(max-width: 760px\)\s*\{\s*\.transfer-desktop-table \{ display: none;/);
  assert.match(styles, /\.transfer-mobile-route b[^}]*overflow-wrap: anywhere/);
});

test('small screens keep wide data intentional, controls touch sized, and dialogs viewport bounded', () => {
  assert.match(styles, /\.data-table-wrap \{ position: relative; overflow-x: auto/);
  assert.match(styles, /inset -14px 0 14px -14px/);
  assert.match(styles, /Swipe horizontally to view all columns/);
  assert.match(styles, /\.button, \.button-small, \.icon-button[^}]*min-height: 44px/);
  assert.match(styles, /max-height: calc\(100dvh - 16px\)/);
  assert.match(styles, /@media \(max-width: 360px\)/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});

test('reports keep all report types and columns available with mobile-sized tabs and functional CSV export', () => {
  for (const type of ['inventory', 'sales', 'transfers', 'storage', 'forecasts']) assert.match(reports, new RegExp(`id: '${type}'`));
  assert.match(reports, /report-tabs-hint/);
  assert.match(reports, /api\(`\/reports\/\$\{tab\}\?format=csv`/);
  assert.match(reports, /className="data-table-wrap"\>\{reportTable\(tab, data\)\}/);
  assert.match(reports, /role="tablist"/);
  assert.match(reports, /Swipe for more report types/);
  assert.match(styles, /\.report-tabs button \{ min-height: 44px; padding: 0 13px; font-size: 11px;/);
});

test('React Router v6 future flags are enabled for the supported v7 transition and splat updates', () => {
  assert.match(routerEntry, /<BrowserRouter future=\{\{ v7_startTransition: true, v7_relativeSplatPath: true \}\}>/);
});
