const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');

jest.mock('../src/db', () => ({ execute: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

function cookie(role = 'pharmacy_manager', pharmacyId = 23) {
  const token = jwt.sign({ pharmacyId, role, fullName: 'Forecast Manager', email: 'forecast@example.test' }, config.jwtSecret, { subject: '12', jwtid: 'test-session', expiresIn: '1h' });
  return `meditrack_session=${token}`;
}

function connection({ history = [{ medicineId: 5, medicineName: 'Fictional Medicine', unitsSold: 12, observedSalesDays: 2 }], stock = [{ medicineId: 5, eligibleUnits: 1 }], failForecast = false } = {}) {
  const conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(), execute: jest.fn() };
  conn.execute.mockImplementation(async (sql) => {
    if (sql.includes('SELECT CURRENT_DATE()')) return [[{ forecastDate: '2026-11-19' }], []];
    if (sql.includes('SELECT id FROM pharmacies')) return [[{ id: 23 }], []];
    if (sql.includes('SELECT b.medicine_id AS medicineId,m.name AS medicineName')) return [history, []];
    if (sql.includes('SELECT b.medicine_id AS medicineId,COALESCE(SUM(i.quantity_on_hand)')) return [stock, []];
    if (failForecast && sql.includes('INSERT INTO forecast_results')) throw Object.assign(new Error('duplicate forecast'), { code: 'ER_DUP_ENTRY' });
    if (sql.includes('INSERT INTO forecast_results')) return [{ insertId: 801 }, []];
    return [{ affectedRows: 1 }, []];
  });
  return conn;
}

describe('sales-based demand forecasts', () => {
  beforeEach(() => { pool.execute.mockReset(); pool.getConnection.mockReset(); });

  test('uses completed sales, eligible stock and writes explainable limited-data results transactionally', async () => {
    const conn = connection(); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/forecasts/generate').set('Cookie', cookie()).send({ horizonDays: 30, lookbackDays: 90 }).expect(201);
    expect(response.body.data[0]).toMatchObject({ predictedDemand: 4, recommendedReorderQuantity: 3, dataQuality: 'insufficient', observedSalesDays: 2 });
    expect(response.body.data[0].explanation).toContain('units sold across 90 calendar days');
    const salesQuery = conn.execute.mock.calls.find(([sql]) => sql.includes('SUM(si.quantity)'))[0];
    expect(salesQuery).toContain("s.status='completed'");
    expect(salesQuery).toContain('INTERVAL ? DAY');
    expect(conn.execute.mock.calls.find(([sql]) => sql.includes('SUM(si.quantity)'))[1]).toEqual([23, 89]);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO forecast_explanations'))).toBe(true);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  test('returns an explicit no-history result and stores no invented forecast', async () => {
    const conn = connection({ history: [] }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/forecasts/generate').set('Cookie', cookie()).send({ horizonDays: 30, lookbackDays: 90 }).expect(200);
    expect(response.body).toMatchObject({ generated: 0, dataQuality: 'insufficient' });
    expect(response.body.message).toContain('No completed sales');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO forecast_results'))).toBe(false);
  });

  test('scoped user cannot request forecast for a different pharmacy', async () => {
    const response = await request(app).post('/api/forecasts/generate').set('Cookie', cookie()).send({ pharmacyId: 42 }).expect(403);
    expect(response.body.error.code).toBe('PHARMACY_FORBIDDEN');
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('invalid horizon values are rejected before connecting to the database', async () => {
    await request(app).post('/api/forecasts/generate').set('Cookie', cookie()).send({ horizonDays: 13 }).expect(400);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('duplicate same-day forecast rolls back without overwriting saved results', async () => {
    const conn = connection({ failForecast: true }); pool.getConnection.mockResolvedValue(conn);
    await request(app).post('/api/forecasts/generate').set('Cookie', cookie()).send({ horizonDays: 30, lookbackDays: 90 }).expect(409);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });
});
