const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');

jest.mock('../src/db', () => ({ execute: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

function session(role, pharmacyId = null) {
  return jwt.sign({ pharmacyId, role, fullName: 'Test User', email: 'user@example.test' }, config.jwtSecret, { subject: '12', jwtid: 'test-session', expiresIn: '1h' });
}

describe('pharmacy selector API', () => {
  beforeEach(() => pool.execute.mockReset());

  test('platform admins can search active pharmacies with parameterized terms', async () => {
    pool.execute.mockResolvedValueOnce([[{ id: 23, name: 'Northside Pharmacy', city: 'Pune', state: 'MH', isActive: 1 }], []]);
    const response = await request(app).get('/api/pharmacies?search=north')
      .set('Cookie', `meditrack_session=${session('platform_admin')}`).expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(pool.execute.mock.calls[0][0]).toContain('p.is_active = TRUE');
    expect(pool.execute.mock.calls[0][0]).toContain('p.name LIKE ?');
    expect(pool.execute.mock.calls[0][1]).toEqual(['%north%', '%north%', '%north%']);
  });

  test('scoped users only receive their assigned pharmacy even when another ID is requested', async () => {
    pool.execute.mockResolvedValueOnce([[{ id: 23, name: 'Northside Pharmacy', city: 'Pune', state: 'MH', isActive: 1 }], []]);
    const response = await request(app).get('/api/pharmacies?pharmacyId=999')
      .set('Cookie', `meditrack_session=${session('pharmacist', 23)}`).expect(200);

    expect(response.body.data.map((row) => row.id)).toEqual([23]);
    expect(pool.execute.mock.calls[0][0]).toContain('p.id = ?');
    expect(pool.execute.mock.calls[0][1]).toEqual([23]);
  });

  test('pharmacy listing requires an authenticated session', async () => {
    await request(app).get('/api/pharmacies').expect(401);
    expect(pool.execute).not.toHaveBeenCalled();
  });

  test('transfer destination lookup reveals active pharmacy names but omits the scoped source', async () => {
    pool.execute.mockResolvedValueOnce([[{ id: 2, name: 'Harborview Family Pharmacy', city: 'Bengaluru', state: 'Karnataka' }], []]);
    const response = await request(app).get('/api/pharmacies/destinations')
      .set('Cookie', `meditrack_session=${session('pharmacy_manager', 1)}`).expect(200);
    expect(response.body.data.map((pharmacy) => pharmacy.id)).toEqual([2]);
    expect(pool.execute.mock.calls[0][0]).toContain('p.id<>?');
    expect(pool.execute.mock.calls[0][1]).toEqual([1]);
  });
});
