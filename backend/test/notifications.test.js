const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');
const { formatStorageNotification } = require('../src/lib/storageNotification');

jest.mock('../src/db', () => ({ execute: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

function cookie(role = 'pharmacist', pharmacyId = 2) {
  const token = jwt.sign({ pharmacyId, role, fullName: 'Rahul Sharma', email: 'rahul@example.test' }, config.jwtSecret, { subject: '22', jwtid: 'test-session', expiresIn: '1h' });
  return `meditrack_session=${token}`;
}

function connection({ events = true } = {}) {
  const conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(), execute: jest.fn() };
  conn.execute.mockImplementation(async (sql) => {
    if (sql.includes("CONCAT('expiry:")) return [events ? [{ pharmacyId: 2, entityId: 81, eventKey: 'expiry:2:81', title: 'Expiring medicine', message: 'Batch E-81', severity: 'high' }] : [], []];
    if (sql.includes("CONCAT('low_stock:")) return [events ? [{ pharmacyId: 2, entityId: 82, eventKey: 'low_stock:2:82', title: 'Low stock', message: 'Batch L-82', severity: 'critical' }] : [], []];
    if (sql.includes("CONCAT('transfer:")) return [events ? [{ pharmacyId: 2, entityId: 83, eventKey: 'transfer:83:requested:2', title: 'Transfer requested', message: 'Transfer T-83', severity: 'high' }] : [], []];
    if (sql.includes("CONCAT('storage:")) return [events ? [{ pharmacyId: 2, entityId: 84, eventKey: 'storage:2:84', title: 'Storage violation', temperatureC: 30, humidityPercent: 70, isWithinRange: 0, conditionStatus: 'normal' }] : [], []];
    if (sql.includes('INSERT INTO notifications')) return [{ affectedRows: 4 }, []];
    if (sql.includes('SELECT COUNT(*) AS total FROM notifications')) return [[{ total: '1' }], []];
    if (sql.includes('FROM notifications n JOIN pharmacies')) return [[{ id: '9', pharmacyId: '2', type: 'low_stock', title: 'Low stock', severity: 'critical', isRead: 0, createdAt: '2026-11-20 08:00:00' }], []];
    if (sql.includes('SELECT COUNT(*) AS count FROM notifications')) return [[{ count: '2' }], []];
    return [{ affectedRows: 0 }, []];
  });
  return conn;
}

describe('pharmacy-scoped notification center', () => {
  beforeEach(() => { pool.execute.mockReset(); pool.getConnection.mockReset(); });

  test('requires authentication', async () => {
    await request(app).get('/api/notifications').expect(401);
    await request(app).get('/api/notifications/unread-count').expect(401);
    await request(app).post('/api/notifications/refresh').expect(401);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('scopes signal materialization to Rahul pharmacy despite a forged query ID', async () => {
    const conn = connection(); pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/notifications/refresh?pharmacyId=77').set('Cookie', cookie()).expect(200);
    expect(response.body.count).toBe(2);
    const sourceCalls = conn.execute.mock.calls.filter(([sql]) => sql.includes('SELECT i.pharmacy_id') || sql.includes('SELECT target.id AS pharmacyId') || sql.includes('SELECT sl.pharmacy_id'));
    expect(sourceCalls).toHaveLength(4);
    sourceCalls.forEach(([, params]) => expect(params).toEqual([2]));
    const transferSignal = conn.execute.mock.calls.find(([sql]) => sql.includes('FROM stock_transfers t'));
    expect(transferSignal[0]).toContain('SELECT target.id AS pharmacyId');
    expect(transferSignal[0]).toContain('AND target.id=?');
    expect(transferSignal[0]).not.toContain('target.pharmacy_id');
    const countCall = conn.execute.mock.calls.find(([sql]) => sql.includes('SELECT COUNT(*) AS count FROM notifications'));
    expect(countCall[1]).toEqual([2]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  test('notification list is a read-only paginated pharmacy-scoped query', async () => {
    pool.execute.mockImplementation(async (sql) => {
      if (sql.includes('COUNT(*) AS total')) return [[{ total: '1' }], []];
      if (sql.includes('COUNT(*) AS count')) return [[{ count: '2' }], []];
      return [[{ id: '9', pharmacyId: '2', isRead: 0, createdAt: '2026-11-20 08:00:00' }], []];
    });
    const response = await request(app).get('/api/notifications?pharmacyId=77&status=unread&page=1&limit=20')
      .set('Cookie', cookie()).expect(200);
    expect(pool.execute.mock.calls.map(([sql]) => sql)).toHaveLength(3);
    expect(response.body).toMatchObject({ unreadCount: 2, pagination: { total: 1, page: 1, limit: 20 } });
    expect(response.body.data[0].pharmacyId).toBe('2');
    expect(pool.execute.mock.calls[0][1]).toEqual([2]);
    expect(pool.execute.mock.calls[1][1]).toEqual([2, 20, 0]);
    expect(pool.execute.mock.calls[2][1]).toEqual([2]);
  });

  test('uses unique event keys and an idempotent upsert to prevent duplicate active events', async () => {
    const conn = connection(); pool.getConnection.mockResolvedValue(conn);
    await request(app).post('/api/notifications/refresh').set('Cookie', cookie()).expect(200);
    const insert = conn.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO notifications'));
    expect(insert[0]).toContain('ON DUPLICATE KEY UPDATE');
    expect(insert[0]).toContain('event_key');
    expect(insert[1]).toContain('expiry:2:81');
    expect(insert[1]).toContain('low_stock:2:82');
    expect(insert[1]).toContain('transfer:83:requested:2');
    expect(insert[1]).toContain('storage:2:84');
  });

  test('refresh updates an existing storage alert instead of suppressing its corrected wording', async () => {
    const conn = connection(); pool.getConnection.mockResolvedValue(conn);
    await request(app).post('/api/notifications/refresh').set('Cookie', cookie()).expect(200);
    const storageQuery = conn.execute.mock.calls.find(([sql]) => sql.includes("CONCAT('storage:"))[0];
    const insert = conn.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO notifications'));
    expect(storageQuery).not.toContain('NOT EXISTS');
    expect(insert[0]).toContain('ON DUPLICATE KEY UPDATE');
    expect(insert[1]).toContain('storage:2:84');
    expect(insert[1]).toContain('Sensor reading is outside the configured storage limits. Temperature 30 °C. Humidity 70%. Recorded physical condition: normal.');
  });

  test('storage alert identifies an out-of-range temperature even when physical condition is normal', () => {
    const alert = formatStorageNotification({ temperatureC: 30, humidityPercent: 50, isWithinRange: 0, conditionStatus: 'normal' });
    expect(alert.severity).toBe('high');
    expect(alert.message).toContain('outside the configured storage limits');
    expect(alert.message).toContain('Temperature 30 °C.');
    expect(alert.message).toContain('Recorded physical condition: normal.');
    expect(alert.message).not.toMatch(/Condition: normal\./);
  });

  test('storage alert identifies an out-of-range humidity even when physical condition is normal', () => {
    const alert = formatStorageNotification({ temperatureC: 20, humidityPercent: 70, isWithinRange: false, conditionStatus: 'normal' });
    expect(alert.severity).toBe('high');
    expect(alert.message).toContain('outside the configured storage limits');
    expect(alert.message).toContain('Humidity 70%.');
    expect(alert.message).toContain('Recorded physical condition: normal.');
  });

  test('read action is bound to the authenticated pharmacy and hides a foreign notification', async () => {
    pool.execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]).mockResolvedValueOnce([[], []]);
    const response = await request(app).patch('/api/notifications/999/read').set('Cookie', cookie()).expect(404);
    expect(response.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    expect(pool.execute.mock.calls[0][0]).toContain('WHERE id=? AND pharmacy_id=?');
    expect(pool.execute.mock.calls[0][1]).toEqual([999, 2]);
  });

  test('marking an already-read notification is idempotent and stays pharmacy-scoped', async () => {
    pool.execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]).mockResolvedValueOnce([[{ id: 9 }], []]);
    await request(app).patch('/api/notifications/9/read').set('Cookie', cookie()).expect(200);
    expect(pool.execute.mock.calls[1][0]).toContain('WHERE id=? AND pharmacy_id=?');
    expect(pool.execute.mock.calls[1][1]).toEqual([9, 2]);
  });

  test('read-all and unread count remain pharmacy-scoped', async () => {
    pool.execute.mockResolvedValueOnce([{ affectedRows: 3 }, []]);
    const response = await request(app).post('/api/notifications/read-all?pharmacyId=77').set('Cookie', cookie()).send({}).expect(200);
    expect(response.body.updated).toBe(3);
    expect(pool.execute.mock.calls[0][0]).toContain('resolved_at IS NULL AND pharmacy_id=?');
    expect(pool.execute.mock.calls[0][1]).toEqual([2]);
    pool.execute.mockResolvedValueOnce([[{ count: '2' }], []]);
    await request(app).get('/api/notifications/unread-count').set('Cookie', cookie()).expect(200);
    expect(pool.execute.mock.calls[1][0]).toContain('pharmacy_id=? AND resolved_at IS NULL AND is_read=FALSE');
    expect(pool.execute.mock.calls[1][1]).toEqual([2]);
  });

  test('platform administrator can refresh platform-wide notification counts', async () => {
    const conn = connection({ events: false }); pool.getConnection.mockResolvedValue(conn);
    await request(app).post('/api/notifications/refresh').set('Cookie', cookie('platform_admin', null)).expect(200);
    const source = conn.execute.mock.calls.find(([sql]) => sql.includes("CONCAT('expiry:"));
    expect(source[0]).not.toContain('i.pharmacy_id=?');
    expect(source[1]).toEqual([]);
    const unread = conn.execute.mock.calls.find(([sql]) => sql.includes('SELECT COUNT(*) AS count FROM notifications'));
    expect(unread[0]).toContain('WHERE resolved_at IS NULL AND is_read=FALSE');
    expect(unread[1]).toEqual([]);
  });

  test('rejects invalid pagination and filter values before querying', async () => {
    await request(app).get('/api/notifications?limit=51').set('Cookie', cookie()).expect(400);
    await request(app).get('/api/notifications?type=unknown').set('Cookie', cookie()).expect(400);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});
