const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');

jest.mock('../src/db', () => ({ execute: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

function session(pharmacyId, role = 'pharmacy_manager') {
  return jwt.sign({ pharmacyId, role, fullName: 'Scoped Manager', email: 'manager@example.test' }, config.jwtSecret, { subject: '12', jwtid: 'test-session', expiresIn: '1h' });
}

describe('pharmacy-scoped inventory access', () => {
  beforeEach(() => { pool.execute.mockReset(); pool.getConnection.mockReset(); });

  test('inventory listing always binds the authenticated pharmacy ID', async () => {
    pool.execute.mockResolvedValueOnce([[{ total: 1 }], []]);
    pool.execute.mockResolvedValueOnce([[{ id: 4, pharmacyId: 23, batchNumber: 'TEST-BATCH', quantityOnHand: 8 }], []]);
    const response = await request(app).get('/api/inventory?page=1&limit=15&pharmacyId=999').set('Cookie', `meditrack_session=${session(23)}`).expect(200);
    expect(response.body.data[0].pharmacyId).toBe(23);
    expect(pool.execute.mock.calls[0][0]).toContain('i.pharmacy_id=?');
    expect(pool.execute.mock.calls[0][1]).toContain(23);
    expect(pool.execute.mock.calls[1][0]).toContain('i.pharmacy_id=?');
    expect(pool.execute.mock.calls[1][1]).toContain(23);
  });

  test('inventory converts MySQL string flags to real booleans', async () => {
    pool.execute.mockResolvedValueOnce([[{ total: 1 }], []]);
    pool.execute.mockResolvedValueOnce([[
      { id: 4, pharmacyId: 23, batchId: 91, quantityOnHand: 9, reorderLevel: 12, isLowStock: '0', isRecalled: '0' },
    ], []]);
    const response = await request(app).get('/api/inventory').set('Cookie', `meditrack_session=${session(23)}`).expect(200);
    expect(response.body.data[0].isLowStock).toBe(false);
    expect(response.body.data[0].isRecalled).toBe(false);
  });

  test('an account without a pharmacy cannot query location inventory', async () => {
    const response = await request(app).get('/api/inventory').set('Cookie', `meditrack_session=${session(null, 'pharmacist')}`).expect(403);
    expect(response.body.error.code).toBe('PHARMACY_REQUIRED');
    expect(pool.execute).not.toHaveBeenCalled();
  });

  test('legacy quick-adjust cannot mutate stock and directs staff to reconciliation review', async () => {
    const response = await request(app).post('/api/inventory/91/adjust').set('Cookie', `meditrack_session=${session(23)}`).send({ delta: 1, reason: 'Count correction' }).expect(409);
    expect(response.body.error.code).toBe('RECONCILIATION_REQUIRED');
    expect(pool.getConnection).not.toHaveBeenCalled();
    expect(pool.execute).not.toHaveBeenCalled();
  });

  test('legacy quick-adjust rejects a pharmacy ID changed by a scoped user', async () => {
    const response = await request(app).post('/api/inventory/91/adjust').set('Cookie', `meditrack_session=${session(23)}`).send({ delta: 1, reason: 'Count correction', pharmacyId: 99 }).expect(403);
    expect(response.body.error.code).toBe('PHARMACY_FORBIDDEN');
    expect(pool.getConnection).not.toHaveBeenCalled();
    expect(pool.execute).not.toHaveBeenCalled();
  });

  test('pharmacy scope is taken from the current session record when token claims are stale', async () => {
    require('../src/lib/sessionStore').findActiveSessionUser.mockResolvedValueOnce({ id: 12, pharmacyId: 44, role: 'pharmacist', fullName: 'Current User', email: 'current@example.test' });
    pool.execute.mockResolvedValueOnce([[{ total: 0 }], []]);
    pool.execute.mockResolvedValueOnce([[], []]);
    await request(app).get('/api/inventory').set('Cookie', `meditrack_session=${session(23)}`).expect(200);
    expect(pool.execute.mock.calls[0][1]).toEqual([44]);
    expect(pool.execute.mock.calls[1][1]).toContain(44);
  });
});
