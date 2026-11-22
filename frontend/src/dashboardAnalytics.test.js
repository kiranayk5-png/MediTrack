import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInventoryHealthSignals, buildSalesSeries, buildStockByMedicine,
  buildStockStatusDistribution, salesEmptyMessage,
} from './dashboardAnalytics.js';

test('sales series normalizes real API values and sorts dates without inventing missing days', () => {
  const series = buildSalesSeries([
    { date: '2026-06-19', revenue: '420.50', transactions: '2' },
    { date: '2026-06-17', revenue: 0, transactions: 0 },
    { date: '2026-06-18', revenue: null, transactions: 1 },
    { date: 'not-a-date', revenue: 10, transactions: 1 },
  ]);
  assert.deepEqual(series, [
    { date: '2026-06-17', revenue: 0, transactions: 0 },
    { date: '2026-06-19', revenue: 420.5, transactions: 2 },
  ]);
  assert.equal(salesEmptyMessage(series), null);
});

test('inventory health indicators use actual batch counts and retain zero-valued signals', () => {
  assert.deepEqual(buildInventoryHealthSignals({ lowStockBatches: '3', expiringBatches: 0, expiredBatches: 1 }).map(({ label, value }) => ({ label, value })), [
    { label: 'Low stock', value: 3 },
    { label: 'Expiring soon', value: 0 },
    { label: 'Expired', value: 1 },
  ]);
  assert.deepEqual(buildInventoryHealthSignals(null), []);
});

test('stock-by-medicine rows discard invalid values while preserving actual zero stock', () => {
  assert.deepEqual(buildStockByMedicine([
    { name: 'Paracetamol', quantity: '8' }, { name: 'Aspirin', quantity: 0 }, { name: '', quantity: 2 }, { name: 'Bad row', quantity: null },
  ]), [{ name: 'Paracetamol', quantity: 8 }, { name: 'Aspirin', quantity: 0 }]);
});

test('status distribution stays empty when the API does not supply distinct status totals', () => {
  assert.deepEqual(buildStockStatusDistribution(undefined), []);
  assert.deepEqual(buildStockStatusDistribution([]), []);
  assert.equal(salesEmptyMessage([]), 'No completed sales are available for this period.');
});
