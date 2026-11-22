const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');

jest.mock('../src/db', () => ({ execute: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

function cookie(role = 'pharmacy_manager', pharmacyId = 23) {
  const token = jwt.sign({ pharmacyId, role, fullName: 'Audit Manager', email: 'audit@example.test' }, config.jwtSecret, { subject: '12', jwtid: 'test-session', expiresIn: '1h' });
  return `meditrack_session=${token}`;
}

describe('audit access and operational reports', () => {
  beforeEach(() => pool.execute.mockReset());

  test('pharmacy manager audit search is scoped and filter values are parameters', async () => {
    pool.execute
      .mockResolvedValueOnce([[{ total: 1 }], []])
      .mockResolvedValueOnce([[{ id: '9', pharmacyId: '23', action: 'inventory.adjusted', details: '{"delta":2}' }], []]);
    const response = await request(app).get('/api/audit?pharmacyId=42&action=inventory.adjusted&from=2026-11-01')
      .set('Cookie', cookie()).expect(200);
    expect(response.body.data[0].details).toEqual({ delta: 2 });
    expect(pool.execute.mock.calls[0][0]).toContain('a.pharmacy_id=?');
    expect(pool.execute.mock.calls[0][1]).toEqual([23, 'inventory.adjusted', '2026-11-01']);
    expect(pool.execute.mock.calls[1][0]).not.toContain('password_hash');
    expect(pool.execute.mock.calls[1][1].slice(-2)).toEqual([50, 0]);
  });

  test('pharmacists cannot browse the audit register', async () => {
    const response = await request(app).get('/api/audit').set('Cookie', cookie('pharmacist')).expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(pool.execute).not.toHaveBeenCalled();
  });

  test('pharmacists cannot query or export audit records by selecting another pharmacy', async () => {
    await request(app).get('/api/audit?pharmacyId=42').set('Cookie', cookie('pharmacist', 2)).expect(403);
    await request(app).get('/api/audit?pharmacyId=42&format=csv').set('Cookie', cookie('pharmacist', 2)).expect(403);
    expect(pool.execute).not.toHaveBeenCalled();
  });

  test('transfer report remains pharmacy-scoped for a manager', async () => {
    pool.execute.mockResolvedValueOnce([[{ requestDate: '2026-11-19', sourcePharmacy: 'Harborview', destinationPharmacy: 'Northside', status: 'received', transferCount: 1, units: 2 }], []]);
    const response = await request(app).get('/api/reports/transfers').set('Cookie', cookie()).expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(pool.execute.mock.calls[0][0]).toContain('(t.source_pharmacy_id=? OR t.destination_pharmacy_id=?)');
    expect(pool.execute.mock.calls[0][1]).toEqual([23, 23]);
  });

  test('storage report supports CSV download using recorded monitoring rows', async () => {
    pool.execute.mockResolvedValueOnce([[{ recordDate: '2026-11-19', pharmacy: 'Harborview', readings: 3, alerts: 1, averageTemperatureC: 9.2, minTemperatureC: 5, maxTemperatureC: 12, averageHumidityPercent: 49 }], []]);
    const response = await request(app).get('/api/reports/storage?format=csv').set('Cookie', cookie()).expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('Average temperature C');
    expect(response.text).toContain('Harborview');
  });
});
