const request = require('./helpers/request');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');

jest.mock('../src/db', () => ({ execute: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

function cookie(role = 'pharmacy_manager', pharmacyId = 23, id = 12) {
  const token = jwt.sign({ pharmacyId, role, fullName: 'Staff Manager', email: 'manager@example.test' }, config.jwtSecret, { subject: String(id), jwtid: 'test-session', expiresIn: '1h' });
  return `meditrack_session=${token}`;
}

function connection(target) {
  const conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(), execute: jest.fn() };
  conn.execute.mockImplementation(async (sql) => {
    if (sql.includes('SELECT id,pharmacy_id AS pharmacyId,role_id AS roleId FROM users')) return [[target], []];
    if (sql.includes('INSERT INTO users')) return [{ insertId: 501 }, []];
    return [{ affectedRows: 1 }, []];
  });
  return conn;
}

describe('staff administration authorization', () => {
  beforeEach(() => { pool.execute.mockReset(); pool.getConnection.mockReset(); });

  test.each(['/api/staff', '/api/staff/roles'])('pharmacist cannot access %s', async (path) => {
    const response = await request(app).get(path).set('Cookie', cookie('pharmacist', 2, 22)).expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(pool.execute).not.toHaveBeenCalled();
  });

  test('pharmacist cannot create or modify staff even with another pharmacy ID', async () => {
    const deniedCreate = await request(app).post('/api/staff').set('Cookie', cookie('pharmacist', 2, 22))
      .send({ pharmacyId: 42, fullName: 'Unauthorized User', email: 'unauthorized@example.test', role: 'pharmacist', password: 'local-test-password-long' })
      .expect(403);
    expect(deniedCreate.body.error.code).toBe('FORBIDDEN');
    await request(app).put('/api/staff/31').set('Cookie', cookie('pharmacist', 2, 22))
      .send({ pharmacyId: 42, fullName: 'Changed', email: 'changed@example.test', role: 'pharmacist', isActive: true })
      .expect(403);
    expect(pool.execute).not.toHaveBeenCalled();
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('pharmacy managers list only users assigned to their own pharmacy', async () => {
    pool.execute.mockResolvedValueOnce([[{ id: '30', pharmacyId: '23', role: 'pharmacist', fullName: 'Local Pharmacist' }], []]);
    const response = await request(app).get('/api/staff?pharmacyId=999').set('Cookie', cookie()).expect(200);
    expect(response.body.data[0].pharmacyId).toBe('23');
    expect(pool.execute.mock.calls[0][0]).toContain('u.pharmacy_id=?');
    expect(pool.execute.mock.calls[0][1]).toEqual([23]);
  });

  test('pharmacy managers cannot create platform administrators', async () => {
    const response = await request(app).post('/api/staff').set('Cookie', cookie()).send({
      fullName: 'Not Allowed', email: 'no.admin@example.test', role: 'platform_admin', password: 'long-demo-password-12',
    }).expect(403);
    expect(response.body.error.code).toBe('ROLE_FORBIDDEN');
    expect(pool.execute).not.toHaveBeenCalled();
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('new passwords are bcrypt-hashed before parameterized insertion and never returned', async () => {
    pool.execute
      .mockResolvedValueOnce([[{ id: 23 }], []])
      .mockResolvedValueOnce([[{ id: 3, name: 'pharmacist' }], []]);
    const conn = connection(); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/staff').set('Cookie', cookie()).send({
      fullName: 'New Pharmacist', email: 'new.pharmacist@example.test', role: 'pharmacist', password: 'local-only-long-password',
    }).expect(201);
    const insert = conn.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO users'));
    expect(insert[1][4]).not.toBe('local-only-long-password');
    expect(await bcrypt.compare('local-only-long-password', insert[1][4])).toBe(true);
    expect(response.body).not.toHaveProperty('password');
    expect(JSON.stringify(response.body)).not.toContain('local-only-long-password');
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  test('pharmacy manager cannot edit a user assigned to another pharmacy', async () => {
    const conn = connection({ id: 31, pharmacyId: 42, roleId: 4 }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).put('/api/staff/31').set('Cookie', cookie()).send({
      fullName: 'Changed Name', email: 'foreign@example.test', role: 'pharmacist', isActive: true,
    }).expect(404);
    expect(response.body.error.code).toBe('STAFF_NOT_FOUND');
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('UPDATE users'))).toBe(false);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  test('manager cannot deactivate or elevate their own account', async () => {
    const conn = connection({ id: 12, pharmacyId: 23, roleId: 2 }); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).put('/api/staff/12').set('Cookie', cookie()).send({
      fullName: 'Staff Manager', email: 'manager@example.test', role: 'pharmacist', isActive: false,
    }).expect(400);
    expect(response.body.error.code).toBe('SELF_ADMIN_CHANGE');
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('UPDATE users'))).toBe(false);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });
});
