const request = require('./helpers/request');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');

jest.mock('../src/db', () => ({ getConnection: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

function session() {
  return jwt.sign({ pharmacyId: 23, role: 'pharmacist', fullName: 'Test Pharmacist', email: 'pharmacist@example.test' }, config.jwtSecret, { subject: '12', jwtid: 'test-session', expiresIn: '1h' });
}

function connection({ quantity = 8, recalled = '0', batches } = {}) {
  const conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(), execute: jest.fn() };
  const eligibleBatches = batches || [{ batchId: 91, quantityOnHand: quantity, expiryDate: '2027-04-30', sellingPrice: 11.5, recalled }];
  conn.execute.mockImplementation(async (sql) => {
    if (sql.includes('SELECT i.batch_id AS batchId')) return [eligibleBatches, []];
    if (sql.includes('SELECT quantity_on_hand AS quantityOnHand')) {
      const batchId = sql.includes('WHERE pharmacy_id=? AND batch_id=?') ? conn.execute.mock.calls.at(-1)[1][1] : 91;
      const batch = eligibleBatches.find((item) => item.batchId === batchId);
      return [batch ? [{ quantityOnHand: batch.quantityOnHand }] : [], []];
    }
    if (sql.includes('INSERT INTO sales')) return [{ insertId: 44 }, []];
    if (sql.includes('INSERT INTO sale_items')) return [{ insertId: 1 }, []];
    return [{ affectedRows: 1, insertId: 1 }, []];
  });
  return conn;
}

describe('transactional FEFO sales', () => {
  beforeEach(() => pool.getConnection.mockReset());

  test('treats MySQL string zero as not recalled and commits eligible stock', async () => {
    const conn = connection(); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/sales').set('Cookie', `meditrack_session=${session()}`).send({ pharmacyId: 999, items: [{ medicineId: 5, quantity: 3 }], discountAmount: 0, taxRate: 0.05 }).expect(201);
    expect(response.body.totalAmount).toBeCloseTo(36.23);
    expect(response.body.allocations).toEqual([expect.objectContaining({ batchId: 91, quantity: 3 })]);
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('UPDATE inventory SET quantity_on_hand'))).toBe(true);
    const eligibleQuery = conn.execute.mock.calls.find(([sql]) => sql.includes('SELECT i.batch_id AS batchId'));
    expect(eligibleQuery[1]).toEqual([23, 5]);
    const saleInsert = conn.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO sales'));
    expect(saleInsert[1][0]).toBe(23);
  });

  test('allocates across batches in FEFO order and records each stock deduction', async () => {
    const conn = connection({ batches: [
      { batchId: 91, quantityOnHand: 2, expiryDate: '2027-02-01', sellingPrice: 10, recalled: 0 },
      { batchId: 92, quantityOnHand: 5, expiryDate: '2027-05-01', sellingPrice: 12, recalled: 0 },
    ] });
    pool.getConnection.mockResolvedValue(conn);

    const response = await request(app).post('/api/sales').set('Cookie', `meditrack_session=${session()}`)
      .send({ items: [{ medicineId: 5, quantity: 4 }] }).expect(201);

    expect(response.body.allocations.map(({ batchId, quantity }) => ({ batchId, quantity }))).toEqual([
      { batchId: 91, quantity: 2 }, { batchId: 92, quantity: 2 },
    ]);
    const eligibilityQuery = conn.execute.mock.calls.find(([sql]) => sql.includes('SELECT i.batch_id AS batchId'))[0];
    expect(eligibilityQuery).toContain('b.expiry_date >= CURDATE()');
    expect(eligibilityQuery).toContain('ORDER BY b.expiry_date ASC, b.id ASC FOR UPDATE');
    const deductions = conn.execute.mock.calls.filter(([sql]) => sql.includes('UPDATE inventory SET quantity_on_hand'));
    expect(deductions.map(([, params]) => params)).toEqual([[0, 23, 91], [3, 23, 92]]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  test('expired-only stock is rejected before any sale rows are inserted', async () => {
    const conn = connection({ batches: [] }); pool.getConnection.mockResolvedValue(conn);
    await request(app).post('/api/sales').set('Cookie', `meditrack_session=${session()}`)
      .send({ items: [{ medicineId: 5, quantity: 1 }] }).expect(409);

    const eligibilityQuery = conn.execute.mock.calls.find(([sql]) => sql.includes('SELECT i.batch_id AS batchId'))[0];
    expect(eligibilityQuery).toContain('b.expiry_date >= CURDATE()');
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO sales'))).toBe(false);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  test('rolls back when eligible stock is unavailable', async () => {
    const conn = connection({ quantity: 1 }); pool.getConnection.mockResolvedValue(conn);
    await request(app).post('/api/sales').set('Cookie', `meditrack_session=${session()}`).send({ items: [{ medicineId: 5, quantity: 4 }] }).expect(409);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO sales'))).toBe(false);
  });

  test('active recall stock is excluded and sale is rolled back', async () => {
    const conn = connection({ quantity: 20, recalled: '1' }); pool.getConnection.mockResolvedValue(conn);
    await request(app).post('/api/sales').set('Cookie', `meditrack_session=${session()}`).send({ items: [{ medicineId: 5, quantity: 1 }] }).expect(409);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    const eligibilityQuery = conn.execute.mock.calls.find(([sql]) => sql.includes('SELECT i.batch_id AS batchId'))[0];
    expect(eligibilityQuery).toContain("rr.status <> 'closed'");
  });

  test('unknown recall flag values fail closed', async () => {
    const conn = connection({ quantity: 20, recalled: 'unknown' }); pool.getConnection.mockResolvedValue(conn);
    await request(app).post('/api/sales').set('Cookie', `meditrack_session=${session()}`)
      .send({ items: [{ medicineId: 5, quantity: 1 }] }).expect(409);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  test('inventory clerks cannot record sales', async () => {
    const clerkToken = jwt.sign({ pharmacyId: 23, role: 'inventory_clerk', fullName: 'Stock Clerk', email: 'clerk@example.test' }, config.jwtSecret, { subject: '15', jwtid: 'test-session', expiresIn: '1h' });
    await request(app).post('/api/sales').set('Cookie', `meditrack_session=${clerkToken}`).send({ items: [{ medicineId: 5, quantity: 1 }] }).expect(403);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('rejects a MySQL bigint medicine ID string with a field-specific validation detail', async () => {
    const conn = connection(); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/sales').set('Cookie', `meditrack_session=${session()}`)
      .send({ items: [{ medicineId: '5', quantity: 1 }], discountAmount: 0, taxRate: 0 }).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'items.0.medicineId' }),
    ]));
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(conn.execute).not.toHaveBeenCalled();
  });
});
