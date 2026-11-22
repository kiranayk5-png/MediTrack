const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');

jest.mock('../src/db', () => ({ execute: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

function cookie(role = 'pharmacist', pharmacyId = 23) {
  const token = jwt.sign({ pharmacyId, role, fullName: 'Storage Pharmacist', email: 'storage@example.test' }, config.jwtSecret, { subject: '12', jwtid: 'test-session', expiresIn: '1h' });
  return `meditrack_session=${token}`;
}

function connection({ policy = { minTemperatureC: 2, maxTemperatureC: 8, minHumidityPercent: null, maxHumidityPercent: null }, failCondition = false } = {}) {
  const conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(), execute: jest.fn() };
  conn.execute.mockImplementation(async (sql) => {
    if (failCondition && sql.includes('INSERT INTO storage_condition_details')) throw new Error('simulated condition detail failure');
    if (sql.includes('FROM storage_policies WHERE pharmacy_id=?')) return [policy ? [policy] : [], []];
    if (sql.includes('SELECT id FROM medicine_batches')) return [[{ id: 91 }], []];
    if (sql.includes('INSERT INTO storage_logs')) return [{ insertId: 70 }, []];
    return [{ affectedRows: 1, insertId: 71 }, []];
  });
  return conn;
}

describe('pharmacy storage policies and monitoring', () => {
  beforeEach(() => { pool.execute.mockReset(); pool.getConnection.mockReset(); });

  test('pharmacy staff cannot read another pharmacy policy', async () => {
    const response = await request(app).get('/api/storage/policy?pharmacyId=42').set('Cookie', cookie()).expect(403);
    expect(response.body.error.code).toBe('PHARMACY_FORBIDDEN');
    expect(pool.execute).not.toHaveBeenCalled();
  });

  test('rejects incomplete or reversed limits without writing a policy', async () => {
    const response = await request(app).put('/api/storage/policy').set('Cookie', cookie('pharmacy_manager')).send({ minTemperatureC: 9, maxTemperatureC: 2 }).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('out-of-range temperature and abnormal condition are saved and audited atomically', async () => {
    const conn = connection(); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/storage').set('Cookie', cookie()).send({ temperatureC: 9.2, conditionStatus: 'power_outage', conditionNotes: 'Backup cooling is active.' }).expect(201);
    expect(response.body).toMatchObject({ isWithinRange: false, alert: true, thresholdsConfigured: true });
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO storage_logs'))).toBe(true);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO storage_condition_details'))).toBe(true);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_logs'))).toBe(true);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  test('does not claim a measurement is compliant when no matching limits are configured', async () => {
    const conn = connection({ policy: null }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/storage').set('Cookie', cookie()).send({ temperatureC: 5, conditionStatus: 'normal' }).expect(201);
    expect(response.body.isWithinRange).toBeNull();
    expect(response.body.alert).toBe(false);
    const insert = conn.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO storage_logs'));
    expect(insert[1][5]).toBeNull();
  });

  test('rolls back a reading if structured condition insertion fails', async () => {
    const conn = connection({ failCondition: true }); pool.getConnection.mockResolvedValue(conn);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    await request(app).post('/api/storage').set('Cookie', cookie()).send({ temperatureC: 5, conditionStatus: 'normal' }).expect(500);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
