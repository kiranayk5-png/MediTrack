const request = require('./helpers/request');
const rawRequest = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');

jest.mock('../src/db', () => ({ execute: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

describe('authentication endpoints', () => {
  beforeEach(() => { pool.execute.mockReset(); require('../src/lib/sessionStore').reset(); });

  test('valid credentials set an HttpOnly session cookie', async () => {
    const passwordHash = await bcrypt.hash('local-test-password', 4);
    pool.execute.mockResolvedValueOnce([[{ id: 7, pharmacyId: 3, fullName: 'Test Pharmacist', email: 'pharmacist@example.test', passwordHash, isActive: 1, role: 'pharmacist' }], []]);
    pool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const response = await request(app).post('/api/auth/login').send({ email: 'pharmacist@example.test', password: 'local-test-password' }).expect(200);
    expect(response.body.user.role).toBe('pharmacist');
    expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(response.headers['set-cookie'][0]).toContain('meditrack_session=');
  });

  test('invalid credentials are rejected without setting a cookie', async () => {
    const passwordHash = await bcrypt.hash('another-password', 4);
    pool.execute.mockResolvedValueOnce([[{ id: 7, pharmacyId: 3, fullName: 'Test Pharmacist', email: 'pharmacist@example.test', passwordHash, isActive: 1, role: 'pharmacist' }], []]);
    const response = await request(app).post('/api/auth/login').send({ email: 'pharmacist@example.test', password: 'wrong-password' }).expect(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  test('protected identity endpoint requires a session', async () => {
    await request(app).get('/api/auth/me').expect(401);
    const token = jwt.sign({ pharmacyId: 3, role: 'pharmacist', fullName: 'Test Pharmacist', email: 'pharmacist@example.test' }, config.jwtSecret, { subject: '7', jwtid: 'test-session', expiresIn: '1h' });
    const response = await request(app).get('/api/auth/me').set('Cookie', `meditrack_session=${token}`).expect(200);
    expect(response.body.user.pharmacyId).toBe(3);
  });

  test('logout revokes the persistent session so a copied token cannot be reused', async () => {
    const token = jwt.sign({ pharmacyId: 3, role: 'pharmacist', fullName: 'Test Pharmacist', email: 'pharmacist@example.test' }, config.jwtSecret, { subject: '7', jwtid: 'copied-token', expiresIn: '1h' });
    await request(app).post('/api/auth/logout').set('Cookie', `meditrack_session=${token}`).expect(204);
    const protectedResponse = await request(app).get('/api/auth/me').set('Cookie', `meditrack_session=${token}`).expect(401);
    expect(protectedResponse.body.error.code).toBe('INVALID_SESSION');
    expect(require('../src/lib/sessionStore').revokeSession).toHaveBeenCalledWith({ userId: '7', tokenId: 'copied-token' });
  });

  test('uses current role and pharmacy from the active server session, not stale JWT claims', async () => {
    const sessionStore = require('../src/lib/sessionStore');
    sessionStore.findActiveSessionUser.mockResolvedValueOnce({ id: 7, pharmacyId: 4, role: 'pharmacy_manager', fullName: 'Updated Manager', email: 'updated@example.test' });
    const token = jwt.sign({ pharmacyId: 3, role: 'pharmacist', fullName: 'Old Name', email: 'old@example.test' }, config.jwtSecret, { subject: '7', jwtid: 'role-change', expiresIn: '1h' });
    const response = await request(app).get('/api/auth/me').set('Cookie', `meditrack_session=${token}`).expect(200);
    expect(response.body.user).toMatchObject({ id: 7, pharmacyId: 4, role: 'pharmacy_manager', fullName: 'Updated Manager' });
  });

  test('rejects deactivated or expired server-side sessions', async () => {
    const sessionStore = require('../src/lib/sessionStore');
    sessionStore.findActiveSessionUser.mockResolvedValueOnce(null);
    const activeJwt = jwt.sign({}, config.jwtSecret, { subject: '7', jwtid: 'deactivated', expiresIn: '1h' });
    await request(app).get('/api/auth/me').set('Cookie', `meditrack_session=${activeJwt}`).expect(401);
    const expiredJwt = jwt.sign({}, config.jwtSecret, { subject: '7', jwtid: 'expired', expiresIn: '-1s' });
    const expired = await request(app).get('/api/auth/me').set('Cookie', `meditrack_session=${expiredJwt}`).expect(401);
    expect(expired.body.error.code).toBe('INVALID_SESSION');
    expect(sessionStore.findActiveSessionUser).toHaveBeenCalledTimes(1);
  });

  test('a role removed in the database immediately loses administrator endpoint access', async () => {
    const sessionStore = require('../src/lib/sessionStore');
    sessionStore.findActiveSessionUser.mockResolvedValueOnce({ id: 7, pharmacyId: 3, role: 'pharmacist', fullName: 'Changed User', email: 'changed@example.test' });
    const token = jwt.sign({ role: 'platform_admin', pharmacyId: null }, config.jwtSecret, { subject: '7', jwtid: 'role-downgrade', expiresIn: '1h' });
    await request(app).get('/api/staff').set('Cookie', `meditrack_session=${token}`).expect(403);
    expect(pool.execute).not.toHaveBeenCalled();
  });

  test('rejects state-changing requests from an untrusted browser origin', async () => {
    const response = await request(app).post('/api/auth/logout').set('Origin', 'https://attacker.example').expect(403);
    expect(response.body.error.code).toBe('ORIGIN_REJECTED');
    expect(require('../src/lib/sessionStore').revokeSession).not.toHaveBeenCalled();
  });

  test('rejects a browser mutation with no Origin header', async () => {
    const response = await request(app).post('/api/auth/logout').unset('Origin').expect(403);
    expect(response.body.error.code).toBe('ORIGIN_REQUIRED');
    expect(require('../src/lib/sessionStore').revokeSession).not.toHaveBeenCalled();
  });

  test('allows explicit non-browser mutation requests without an Origin header', async () => {
    await rawRequest(app).post('/api/auth/logout')
      .set('X-MediTrack-Client', 'non-browser').expect(204);
  });

  test('allows credentialed CORS preflight only for the configured frontend origin', async () => {
    const response = await request(app).options('/api/auth/login')
      .set('Origin', config.frontendOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(config.frontendOrigin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});
