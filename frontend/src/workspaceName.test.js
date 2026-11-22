import test from 'node:test';
import assert from 'node:assert/strict';
import { getWorkspaceName } from './workspaceName.js';

test('shows the name of the authenticated pharmacy assignment', () => {
  assert.equal(getWorkspaceName({ pharmacyId: 2 }, [{ id: '2', name: 'Harborview Family Pharmacy' }]), 'Harborview Family Pharmacy');
});

test('does not guess a pharmacy name when the scoped pharmacy lookup is unavailable', () => {
  assert.equal(getWorkspaceName({ pharmacyId: 2 }, []), 'Assigned pharmacy');
  assert.equal(getWorkspaceName({ pharmacyId: null }, []), 'Platform workspace');
});
