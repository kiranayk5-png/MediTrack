import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDiscrepancy, canReviewReconciliation } from './reconciliation.js';

test('calculates positive, negative, zero, and uncounted discrepancies', () => {
  assert.equal(calculateDiscrepancy(12, 9), 3);
  assert.equal(calculateDiscrepancy(4, 9), -5);
  assert.equal(calculateDiscrepancy(9, 9), 0);
  assert.equal(calculateDiscrepancy(null, 9), null);
});

test('review action requires a manager role, submitted state, and a different reviewer', () => {
  const submittedByClerk = { status: 'submitted', createdBy: 12 };
  assert.equal(canReviewReconciliation({ id: 19, role: 'pharmacy_manager' }, submittedByClerk), true);
  assert.equal(canReviewReconciliation({ id: 12, role: 'pharmacy_manager' }, submittedByClerk), false);
  assert.equal(canReviewReconciliation({ id: 19, role: 'pharmacist' }, submittedByClerk), false);
  assert.equal(canReviewReconciliation({ id: 19, role: 'platform_admin' }, submittedByClerk), true);
  assert.equal(canReviewReconciliation({ id: 19, role: 'pharmacy_manager' }, { ...submittedByClerk, status: 'draft' }), false);
});
