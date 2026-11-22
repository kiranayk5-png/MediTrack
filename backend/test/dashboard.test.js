const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');

jest.mock('../src/db', () => ({ execute: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

function adminSession() {
  return jwt.sign(
    { pharmacyId: null, role: 'platform_admin', fullName: 'Morgan Demo', email: 'morgan.admin@example.test' },
    config.jwtSecret,
    { subject: '1', jwtid: 'test-session', expiresIn: '1h' },
  );
}

function pharmacistSession() {
  return jwt.sign(
    { pharmacyId: 2, role: 'pharmacist', fullName: 'Rahul Sharma', email: 'rahul@example.test' },
    config.jwtSecret,
    { subject: '22', jwtid: 'test-session', expiresIn: '1h' },
  );
}

describe('platform administrator dashboard access', () => {
  beforeEach(() => pool.execute.mockReset());

  test('unauthenticated dashboard requests return 401', async () => {
    const response = await request(app).get('/api/dashboard').expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  test('platform_admin without a selected pharmacy receives all-pharmacy aggregates', async () => {
    pool.execute
      .mockResolvedValueOnce([[{ total: 8 }], []])
      .mockResolvedValueOnce([[{ units: 90, lowStockBatches: 2 }], []])
      .mockResolvedValueOnce([[{ expiringBatches: 1, expiredBatches: 0 }], []])
      .mockResolvedValueOnce([[{ todayRevenue: 125.5, todayTransactions: 2 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);

    const response = await request(app)
      .get('/api/dashboard')
      .set('Cookie', `meditrack_session=${adminSession()}`)
      .expect(200);

    expect(response.body.pharmacyId).toBeNull();
    expect(response.body.metrics.totalMedicines).toBe(8);
    expect(response.body.metrics.availableUnits).toBe(90);
    expect(response.body.metrics.todayRevenue).toBe(125.5);
    expect(pool.execute).toHaveBeenCalledTimes(7);
    for (const [sql, params = []] of pool.execute.mock.calls) {
      expect(sql).not.toMatch(/\bWHERE\b[^]*pharmacy_id\s*=\s*\?/i);
      expect(params).toEqual([]);
    }
  });

  test('pharmacist dashboard queries are pharmacy-scoped, including the joined audit query', async () => {
    pool.execute
      .mockResolvedValueOnce([[{ total: 3 }], []])
      .mockResolvedValueOnce([[{ units: 28, lowStockBatches: 1 }], []])
      .mockResolvedValueOnce([[{ expiringBatches: 1, expiredBatches: 0 }], []])
      .mockResolvedValueOnce([[{ todayRevenue: 21, todayTransactions: 1 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);

    const response = await request(app)
      .get('/api/dashboard')
      .set('Cookie', `meditrack_session=${pharmacistSession()}`)
      .expect(200);

    expect(response.body.pharmacyId).toBe(2);
    expect(response.body.metrics).toMatchObject({ totalMedicines: 3, availableUnits: 28, todayRevenue: 21 });
    expect(pool.execute).toHaveBeenCalledTimes(7);
    for (const [sql, params] of pool.execute.mock.calls) {
      expect(sql).toMatch(/pharmacy_id\s*=\s*\?/i);
      expect(params).toEqual([2]);
    }
    const auditCall = pool.execute.mock.calls.find(([sql]) => sql.includes('FROM audit_logs'));
    expect(auditCall[0]).toContain('a.pharmacy_id = ?');
  });
});
