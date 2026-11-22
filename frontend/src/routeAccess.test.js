import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canAccessManagementRoutes } from './routeAccess.js';

test('staff and audit routes are hidden from pharmacist and inventory clerk roles', () => {
  assert.equal(canAccessManagementRoutes('pharmacist'), false);
  assert.equal(canAccessManagementRoutes('inventory_clerk'), false);
});

test('staff and audit routes remain available to authorized management roles', () => {
  assert.equal(canAccessManagementRoutes('platform_admin'), true);
  assert.equal(canAccessManagementRoutes('pharmacy_manager'), true);
});

test('application applies the management role gate to both protected routes', async () => {
  const app = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/staff" element=\{canAccessManagementRoutes\(user\?\.role\)/);
  assert.match(app, /path="\/audit" element=\{canAccessManagementRoutes\(user\?\.role\)/);
});

test('inventory reconciliation route and sidebar entry are registered', async () => {
  const app = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
  const shell = await readFile(new URL('./components/Shell.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/reconciliation" element=\{<InventoryReconciliationPage \/>\}/);
  assert.match(shell, /to: '\/reconciliation', label: 'Inventory reconciliation'/);
});
