import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSalePayload, checkoutValidationMessage } from './salePayload.js';

test('normalizes MySQL bigint string IDs into the numeric sales API contract', () => {
  const payload = buildSalePayload({
    role: 'platform_admin',
    pharmacyId: '18',
    cart: [{ medicineId: '402', quantity: 1 }],
    discount: '0',
  });

  assert.deepEqual(payload, {
    pharmacyId: 18,
    items: [{ medicineId: 402, quantity: 1 }],
    discountAmount: 0,
    taxRate: 0,
  });
  assert.equal(typeof payload.items[0].medicineId, 'number');
});

test('rejects IDs that cannot be represented safely as JavaScript integers', () => {
  assert.throws(() => buildSalePayload({
    role: 'platform_admin', pharmacyId: '18', cart: [{ medicineId: '9007199254740993', quantity: 1 }], discount: '0',
  }), /Medicine ID must be a valid positive whole number/);
});

test('maps backend Zod paths to safe, actionable checkout messages', () => {
  const message = checkoutValidationMessage({
    code: 'VALIDATION_ERROR',
    details: [
      { path: 'items.0.medicineId', message: 'private internal schema wording' },
      { path: 'discountAmount', message: 'private internal schema wording' },
    ],
  });

  assert.match(message, /medicine selection is invalid/i);
  assert.match(message, /discount must be zero/i);
  assert.doesNotMatch(message, /private internal/);
});
