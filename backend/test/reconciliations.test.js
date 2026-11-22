const request = require('./helpers/request');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');
const { calculateDiscrepancy, splitHistoryDeltas } = require('../src/lib/reconciliation');

jest.mock('../src/db', () => ({ execute: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

function cookie({ role = 'pharmacist', pharmacyId = 2, userId = 12 } = {}) {
  const token = jwt.sign({ pharmacyId, role, fullName: 'Reconciliation User', email: 'count@example.test' }, config.jwtSecret, { subject: String(userId), jwtid: 'test-session', expiresIn: '1h' });
  return `meditrack_session=${token}`;
}

const submittedSession = (overrides = {}) => ({ id: 41, pharmacyId: 2, status: 'submitted', createdBy: 13, ...overrides });
const currentItem = (overrides = {}) => ({
  batchId: 81, systemQuantity: 10, physicalQuantity: 8, systemUpdatedAt: new Date('2026-01-01T00:00:00Z'),
  systemHistoryId: '100', reasonCode: 'missing_stock', reasonExplanation: null,
  currentQuantity: 10, currentUpdatedAt: new Date('2026-01-01T00:00:00Z'), currentHistoryId: '100', ...overrides,
});

function connection({ session = submittedSession(), items = [currentItem()], submitRows = [] , failStockHistory = false } = {}) {
  const conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(), execute: jest.fn() };
  conn.execute.mockImplementation(async (sql) => {
    if (sql.includes('FROM inventory_reconciliation_sessions WHERE id=? FOR UPDATE')) return [[session], []];
    if (sql.includes('FROM inventory_reconciliation_items ri JOIN inventory i')) return [items, []];
    if (sql.includes('FROM inventory_reconciliation_items ri JOIN medicine_batches')) return [submitRows, []];
    if (failStockHistory && sql.includes('INSERT INTO stock_history')) throw new Error('simulated history write failure');
    if (sql.includes('UPDATE inventory SET quantity_on_hand')) return [{ affectedRows: 1 }, []];
    if (sql.includes('INSERT INTO stock_history')) return [{ insertId: 501 }, []];
    return [{ affectedRows: 1, insertId: 41 }, []];
  });
  return conn;
}

describe('inventory reconciliation workflow', () => {
  beforeEach(() => { pool.execute.mockReset(); pool.getConnection.mockReset(); });

  test('calculates signed count discrepancies', () => {
    expect(calculateDiscrepancy(7, 10)).toBe(-3);
    expect(calculateDiscrepancy(14, 10)).toBe(4);
    expect(calculateDiscrepancy(10, 10)).toBe(0);
    expect(splitHistoryDeltas(-3000000000)).toEqual([-2147483648, -852516352]);
    expect(splitHistoryDeltas(3000000000)).toEqual([2147483647, 852516353]);
  });

  test('creates an inventory reconciliation targeted to the requested batch in the authorized pharmacy', async () => {
    const conn = connection();
    conn.execute.mockImplementation(async (sql) => {
      if (sql.includes('FROM pharmacies WHERE id=?')) return [[{ id: 2 }], []];
      if (sql.includes('INSERT INTO inventory_reconciliation_sessions')) return [{ insertId: 42 }, []];
      if (sql.includes('INSERT INTO inventory_reconciliation_items')) return [{ affectedRows: 1 }, []];
      return [{ affectedRows: 1 }, []];
    });
    pool.getConnection.mockResolvedValue(conn);
    const token = cookie({ role: 'platform_admin', pharmacyId: null });
    const response = await request(app).post('/api/reconciliations').set('Cookie', token)
      .send({ pharmacyId: 2, batchIds: [81] }).expect(201);
    expect(response.body).toMatchObject({ pharmacyId: 2, itemCount: 1 });
    const insertion = conn.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO inventory_reconciliation_items'));
    expect(insertion[0]).toContain('i.batch_id IN (?)');
    expect(insertion[1]).toEqual([42, 2, 81]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  test('rolls back a targeted reconciliation when any selected batch is outside the pharmacy', async () => {
    const conn = connection();
    conn.execute.mockImplementation(async (sql) => {
      if (sql.includes('FROM pharmacies WHERE id=?')) return [[{ id: 2 }], []];
      if (sql.includes('INSERT INTO inventory_reconciliation_sessions')) return [{ insertId: 42 }, []];
      if (sql.includes('INSERT INTO inventory_reconciliation_items')) return [{ affectedRows: 0 }, []];
      return [{ affectedRows: 1 }, []];
    });
    pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/reconciliations').set('Cookie', cookie({ role: 'platform_admin', pharmacyId: null }))
      .send({ pharmacyId: 2, batchIds: [999] }).expect(404);
    expect(response.body.error.code).toBe('INVALID_RECONCILIATION_ITEM');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  test('ordinary staff cannot approve adjustments', async () => {
    await request(app).post('/api/reconciliations/41/approve').set('Cookie', cookie()).expect(403);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('rejects cross-pharmacy manager access without exposing the session', async () => {
    const conn = connection({ session: submittedSession({ pharmacyId: 9 }) }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/reconciliations/41/approve').set('Cookie', cookie({ role: 'pharmacy_manager' })).expect(404);
    expect(response.body.error.code).toBe('RECONCILIATION_NOT_FOUND');
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('UPDATE inventory SET'))).toBe(false);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  test('prevents a user from approving their own submission', async () => {
    const conn = connection({ session: submittedSession({ createdBy: 12 }) }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/reconciliations/41/approve').set('Cookie', cookie({ role: 'pharmacy_manager' })).expect(403);
    expect(response.body.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('UPDATE inventory SET'))).toBe(false);
  });

  test('only the draft owner can submit a count for review', async () => {
    const conn = connection({ session: submittedSession({ status: 'draft', createdBy: 14 }) }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/reconciliations/41/submit').set('Cookie', cookie()).expect(403);
    expect(response.body.error.code).toBe('RECONCILIATION_OWNER_REQUIRED');
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('FROM inventory_reconciliation_items ri JOIN medicine_batches'))).toBe(false);
  });

  test('marks a count stale when stock quantity changed after the snapshot', async () => {
    const conn = connection({ items: [currentItem({ currentQuantity: 11, currentHistoryId: '101' })] }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/reconciliations/41/approve').set('Cookie', cookie({ role: 'pharmacy_manager', userId: 22 })).expect(409);
    expect(response.body.error.code).toBe('STALE_RECONCILIATION');
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes("status='stale'"))).toBe(true);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('UPDATE inventory SET'))).toBe(false);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO stock_history'))).toBe(false);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  test('detects intervening stock history even when quantity returned to its snapshot amount', async () => {
    const conn = connection({ items: [currentItem({ currentHistoryId: '103' })] }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/reconciliations/41/approve').set('Cookie', cookie({ role: 'pharmacy_manager', userId: 22 })).expect(409);
    expect(response.body.error.code).toBe('STALE_RECONCILIATION');
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('UPDATE inventory SET'))).toBe(false);
  });

  test('applies adjustments, stock history, and audit atomically after revalidation', async () => {
    const conn = connection(); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/reconciliations/41/approve').set('Cookie', cookie({ role: 'pharmacy_manager', userId: 22 })).expect(200);
    expect(response.body).toMatchObject({ status: 'approved', adjustedItems: 1 });
    const update = conn.execute.mock.calls.find(([sql]) => sql.includes('UPDATE inventory SET quantity_on_hand'));
    expect(update[1]).toEqual([8, 2, 81, 10]);
    const history = conn.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO stock_history'));
    expect(history[0]).toContain("'adjustment'");
    expect(history[1]).toEqual([2, 81, 22, -2, 8, 41, 'missing_stock: Physical stock count']);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_logs'))).toBe(true);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  test('rolls back quantity change if the stock-history write fails', async () => {
    const conn = connection({ failStockHistory: true }); pool.getConnection.mockResolvedValue(conn);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    await request(app).post('/api/reconciliations/41/approve').set('Cookie', cookie({ role: 'pharmacy_manager', userId: 22 })).expect(500);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('UPDATE inventory SET'))).toBe(true);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  test('prevents duplicate approval from applying stock twice', async () => {
    const conn = connection({ session: submittedSession({ status: 'approved' }) }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/reconciliations/41/approve').set('Cookie', cookie({ role: 'pharmacy_manager', userId: 22 })).expect(409);
    expect(response.body.error.code).toBe('INVALID_RECONCILIATION_STATE');
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('UPDATE inventory SET'))).toBe(false);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  test('rejection records review state without changing inventory', async () => {
    const conn = connection(); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/reconciliations/41/reject').set('Cookie', cookie({ role: 'pharmacy_manager', userId: 22 })).send({ reason: 'Count sheet is incomplete.' }).expect(200);
    expect(response.body.status).toBe('rejected');
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes("status='rejected'"))).toBe(true);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('UPDATE inventory SET'))).toBe(false);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO stock_history'))).toBe(false);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  test('submission requires a reason for every non-zero discrepancy', async () => {
    const conn = connection({ session: submittedSession({ status: 'draft', createdBy: 12 }), submitRows: [{ batchId: 81, batchNumber: 'HV-81', systemQuantity: 10, physicalQuantity: 8, reasonCode: null }] }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/reconciliations/41/submit').set('Cookie', cookie()).expect(400);
    expect(response.body.error.code).toBe('REASON_REQUIRED');
    expect(conn.commit).not.toHaveBeenCalled();
  });

  test('submission requires an explanation when the reason is other', async () => {
    const conn = connection({ session: submittedSession({ status: 'draft', createdBy: 12 }), submitRows: [{ batchId: 81, batchNumber: 'HV-81', systemQuantity: 10, physicalQuantity: 8, reasonCode: 'other', reasonExplanation: null }] }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/reconciliations/41/submit').set('Cookie', cookie()).expect(400);
    expect(response.body.error.code).toBe('EXPLANATION_REQUIRED');
    expect(conn.commit).not.toHaveBeenCalled();
  });
});
