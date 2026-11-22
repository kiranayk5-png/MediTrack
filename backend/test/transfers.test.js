const request = require('./helpers/request');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');

jest.mock('../src/db', () => ({ execute: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

function cookie(pharmacyId = 23, role = 'pharmacy_manager') {
  const token = jwt.sign({ pharmacyId, role, fullName: 'Transfer Manager', email: 'transfer@example.test' }, config.jwtSecret, { subject: '12', jwtid: 'test-session', expiresIn: '1h' });
  return `meditrack_session=${token}`;
}

function connection(options = {}) {
  const transfer = { id: 71, sourcePharmacyId: 23, destinationPharmacyId: 42, batchId: 91, requestedBy: 12, quantity: 3, status: 'approved', ...options.transfer };
  const stock = { quantityOnHand: 5, isExpired: '0', recalled: '0', ...options.stock };
  const conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(), execute: jest.fn() };
  conn.execute.mockImplementation(async (sql) => {
    if (options.failHistory && sql.includes('INSERT INTO stock_history')) throw new Error('simulated ledger failure');
    if (sql.includes('FROM stock_transfers WHERE id=? FOR UPDATE')) return [[transfer], []];
    if (sql.includes('SELECT id FROM pharmacies WHERE id IN')) return [[{ id: 23 }, { id: 42 }], []];
    if (sql.includes('SELECT i.quantity_on_hand AS quantityOnHand')) return [[stock], []];
    if (sql.includes('SELECT id,medicine_id AS medicineId')) return [[{ id: 91, medicineId: 8, batchNumber: 'LOT-A', manufactureDate: '2026-01-01', expiryDate: '2027-04-30', purchasePrice: 11, sellingPrice: 20, pharmacyId: 23 }], []];
    if (sql.includes('SELECT EXISTS(SELECT 1 FROM recall_records')) return [[{ recalled: '0' }], []];
    if (sql.includes('SELECT id,manufacture_date AS manufactureDate')) return [options.destinationBatches || [], []];
    if (sql.includes('SELECT quantity_on_hand AS quantityOnHand')) return [options.destinationBalances || [], []];
    if (sql.includes('INSERT INTO stock_transfers')) return [{ insertId: 71 }, []];
    if (sql.includes('INSERT INTO medicine_batches')) return [{ insertId: 500 }, []];
    return [{ affectedRows: 1, insertId: 900 }, []];
  });
  return conn;
}

describe('inter-pharmacy transfer controls', () => {
  beforeEach(() => { pool.execute.mockReset(); pool.getConnection.mockReset(); });

  test('transfer list is restricted to source or destination pharmacy', async () => {
    pool.execute.mockResolvedValueOnce([[{ id: '71', sourcePharmacyId: '23', destinationPharmacyId: '42' }], []]);
    const response = await request(app).get('/api/transfers').set('Cookie', cookie(23)).expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(pool.execute.mock.calls[0][0]).toContain('(t.source_pharmacy_id=? OR t.destination_pharmacy_id=?)');
    expect(pool.execute.mock.calls[0][1]).toEqual([23, 23, 50]);
  });

  test('rejects same-pharmacy transfers and invalid quantities before transaction work', async () => {
    const conn = connection(); pool.getConnection.mockResolvedValue(conn);
    await request(app).post('/api/transfers').set('Cookie', cookie(23)).send({ destinationPharmacyId: 23, batchId: 91, quantity: 1 }).expect(400);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    await request(app).post('/api/transfers').set('Cookie', cookie(23)).send({ destinationPharmacyId: 42, batchId: 91, quantity: 0 }).expect(400);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  test('scoped request ignores forged source pharmacy and writes only a request transactionally', async () => {
    const conn = connection(); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/transfers').set('Cookie', cookie(23)).send({ sourcePharmacyId: 999, destinationPharmacyId: 42, batchId: 91, quantity: 2 }).expect(201);
    expect(response.body.status).toBe('requested');
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    const insert = conn.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO stock_transfers'));
    expect(insert[1].slice(0, 3)).toEqual([23, 42, 91]);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('UPDATE inventory'))).toBe(false);
  });

  test('shipment decrements source stock and writes movement, status, and audit in one commit', async () => {
    const conn = connection(); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/transfers/71/ship').set('Cookie', cookie(23)).send({}).expect(200);
    expect(response.body).toMatchObject({ status: 'in_transit', sourceQuantityOnHand: 2 });
    expect(conn.execute.mock.calls.some(([sql, params]) => sql.includes('UPDATE inventory') && params[0] === 2 && params[1] === 23)).toBe(true);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes("'transfer_out'"))).toBe(true);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes("status='in_transit'"))).toBe(true);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  test('shipment rejects recalled stock without deducting inventory', async () => {
    const conn = connection({ stock: { recalled: '1' } }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/transfers/71/ship').set('Cookie', cookie(23)).send({}).expect(409);
    expect(response.body.error.code).toBe('BATCH_RECALLED');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('UPDATE inventory'))).toBe(false);
  });

  test('receipt creates destination batch and inventory balance in one transaction', async () => {
    const conn = connection({ transfer: { status: 'in_transit' } }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/transfers/71/receive').set('Cookie', cookie(42)).send({}).expect(200);
    expect(response.body).toMatchObject({ status: 'received', destinationBatchId: 500, destinationQuantityOnHand: 3 });
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO medicine_batches'))).toBe(true);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO inventory'))).toBe(true);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes("'transfer_in'"))).toBe(true);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes("status='received'"))).toBe(true);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  test('destination cannot receive a transfer for a different pharmacy', async () => {
    const conn = connection({ transfer: { status: 'in_transit' } }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/transfers/71/receive').set('Cookie', cookie(99)).send({}).expect(403);
    expect(response.body.error.code).toBe('PHARMACY_FORBIDDEN');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.execute.mock.calls).toHaveLength(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  test('ledger failure rolls back shipment stock updates and leaves status unchanged', async () => {
    const conn = connection({ failHistory: true }); pool.getConnection.mockResolvedValue(conn);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    await request(app).post('/api/transfers/71/ship').set('Cookie', cookie(23)).send({}).expect(500);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
