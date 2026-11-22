import test from 'node:test';
import assert from 'node:assert/strict';
import { formatInventoryDate, inventoryDateKey, isInventoryDateExpired } from './inventoryDates.js';

test('inventory expiry keeps batches expiring today in-date and marks only earlier dates expired', () => {
  const today = new Date(2026, 10, 21, 12, 0, 0);
  assert.equal(isInventoryDateExpired('2026-11-20', today), true);
  assert.equal(isInventoryDateExpired('2026-11-21', today), false);
  assert.equal(isInventoryDateExpired('2026-11-22', today), false);
});

test('inventory date formatting handles SQL date strings and Date values consistently', () => {
  assert.equal(inventoryDateKey('2026-11-21T00:00:00.000Z'), '2026-11-21');
  assert.equal(inventoryDateKey(new Date('2026-11-21T00:00:00.000Z')), '2026-11-21');
  assert.equal(formatInventoryDate(null), 'Date unavailable');
  assert.match(formatInventoryDate('2026-11-21'), /21/);
});
