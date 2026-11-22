const request = require('./helpers/request');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');

jest.mock('../src/db', () => ({ execute: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

function rahulCookie() {
  const token = jwt.sign(
    { pharmacyId: 2, role: 'pharmacist', fullName: 'Rahul Sharma', email: 'rahul@example.test' },
    config.jwtSecret,
    { subject: '22', jwtid: 'test-session', expiresIn: '1h' },
  );
  return `meditrack_session=${token}`;
}

describe('Rahul Sharma pharmacist access boundaries', () => {
  beforeEach(() => { pool.execute.mockReset(); pool.getConnection.mockReset(); });

  test('can read assigned pharmacy inventory while a forged pharmacy query parameter is ignored', async () => {
    pool.execute.mockResolvedValueOnce([[{ total: 1 }], []])
      .mockResolvedValueOnce([[{ id: '8', pharmacyId: '2', medicineName: 'Test medicine' }], []]);
    const response = await request(app).get('/api/inventory?pharmacyId=42')
      .set('Cookie', rahulCookie()).expect(200);
    expect(response.body.data[0].pharmacyId).toBe('2');
    expect(pool.execute.mock.calls).toHaveLength(2);
    for (const [sql, params] of pool.execute.mock.calls) {
      expect(sql).toMatch(/i\.pharmacy_id\s*=\s*\?/i);
      expect(params).toContain(2);
      expect(params).not.toContain(42);
    }
  });

  test('can read assigned pharmacy sales while a forged pharmacy query parameter is ignored', async () => {
    pool.execute.mockResolvedValueOnce([[{ id: '13', pharmacyId: '2', lineCount: 1 }], []]);
    const response = await request(app).get('/api/sales?pharmacyId=42')
      .set('Cookie', rahulCookie()).expect(200);
    expect(response.body.data[0].pharmacyId).toBe('2');
    expect(pool.execute.mock.calls[0][0]).toContain('WHERE s.pharmacy_id=?');
    expect(pool.execute.mock.calls[0][1]).toEqual([2, 25]);
  });

  test('can read own pharmacy name and storage policy, but cannot read another pharmacy policy', async () => {
    pool.execute.mockResolvedValueOnce([[{ id: 2, name: 'Harborview Family Pharmacy', city: 'Bengaluru', state: 'Karnataka', isActive: 1 }], []])
      .mockResolvedValueOnce([[{ pharmacyId: 2, minTemperatureC: 2, maxTemperatureC: 8 }], []]);
    const pharmacies = await request(app).get('/api/pharmacies?pharmacyId=42').set('Cookie', rahulCookie()).expect(200);
    expect(pharmacies.body.data).toEqual([expect.objectContaining({ id: 2, name: 'Harborview Family Pharmacy' })]);
    expect(pool.execute.mock.calls[0][1]).toEqual([2]);
    const policy = await request(app).get('/api/storage/policy').set('Cookie', rahulCookie()).expect(200);
    expect(policy.body.data.pharmacyId).toBe(2);
    await request(app).get('/api/storage/policy?pharmacyId=42').set('Cookie', rahulCookie()).expect(403);
    expect(pool.execute).toHaveBeenCalledTimes(2);
  });

  test('cannot adjust another pharmacy stock or write storage readings to it', async () => {
    await request(app).post('/api/inventory/8/adjust').set('Cookie', rahulCookie())
      .send({ pharmacyId: 42, delta: 1, reason: 'Unauthorized location adjustment' }).expect(403);
    await request(app).post('/api/storage').set('Cookie', rahulCookie())
      .send({ pharmacyId: 42, temperatureC: 5, conditionStatus: 'normal' }).expect(403);
    expect(pool.execute).not.toHaveBeenCalled();
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});
