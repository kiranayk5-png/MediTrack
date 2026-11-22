import test from 'node:test';
import assert from 'node:assert/strict';
import { isMedicineActive, sortMedicineRows } from './medicineTable.js';

test('medicine catalogue sorting is stable to source order and does not mutate API rows', () => {
  const rows = [{ id: 1, name: 'Zinc' }, { id: 2, name: 'Amoxicillin' }, { id: 3, name: 'Vitamin B12' }];
  const sorted = sortMedicineRows(rows, { key: 'name', direction: 'asc' });
  assert.deepEqual(sorted.map((row) => row.id), [2, 3, 1]);
  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3]);
  assert.deepEqual(sortMedicineRows(rows, { key: 'name', direction: 'desc' }).map((row) => row.id), [1, 3, 2]);
});

test('catalogue status sorting handles MySQL boolean representations without treating string zero as active', () => {
  const rows = [{ id: 1, isActive: 0 }, { id: 2, isActive: true }, { id: 3, isActive: '1' }, { id: 4, isActive: '0' }];
  assert.deepEqual(sortMedicineRows(rows, { key: 'status', direction: 'asc' }).map((row) => row.id), [1, 4, 2, 3]);
  assert.deepEqual(sortMedicineRows(rows, { key: 'status', direction: 'desc' }).map((row) => row.id), [2, 3, 1, 4]);
  assert.equal(isMedicineActive('0'), false);
});

test('catalogue sorting and empty states handle missing rows and values', () => {
  assert.deepEqual(sortMedicineRows(undefined, { key: 'name' }), []);
  assert.deepEqual(sortMedicineRows([{ id: 1 }, { id: 2, name: 'Paracetamol' }], { key: 'name' }).map((row) => row.id), [1, 2]);
});
