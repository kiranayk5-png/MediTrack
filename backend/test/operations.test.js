const request = require('./helpers/request');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');

jest.mock('../src/db', () => ({ execute: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/lib/sessionStore', () => require('./helpers/sessionStoreMock'));

function session(role = 'pharmacy_manager', pharmacyId = 23) {
  return jwt.sign({ pharmacyId, role, fullName: 'Test Manager', email: 'manager@example.test' }, config.jwtSecret, { subject: '12', jwtid: 'test-session', expiresIn: '1h' });
}

const cookie = (role, pharmacyId) => `meditrack_session=${session(role, pharmacyId)}`;

describe('catalogue, inventory, supplier and reporting operations', () => {
  beforeEach(() => { pool.execute.mockReset(); pool.getConnection.mockReset(); });

  test('medicine create and update use validated, parameterized values', async () => {
    pool.execute.mockResolvedValueOnce([{ insertId: 501 }, []]);
    await request(app).post('/api/medicines').set('Cookie', cookie()).send({ name: 'Fictional Relief', strength: '250 mg' }).expect(201);
    expect(pool.execute.mock.calls[0][0]).toContain('INSERT INTO medicines');
    expect(pool.execute.mock.calls[0][1]).toContain('Fictional Relief');

    pool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await request(app).put('/api/medicines/501').set('Cookie', cookie()).send({ name: 'Fictional Relief Plus', isActive: false }).expect(200);
    expect(pool.execute.mock.calls[1][0]).toContain('WHERE id = ?');
    expect(pool.execute.mock.calls[1][1].at(-1)).toBe(501);
  });

  test('legacy quick adjustment now requires a reviewed reconciliation and makes no database call', async () => {
    const response = await request(app).post('/api/inventory/91/adjust').set('Cookie', cookie())
      .send({ delta: 3, reason: 'Cycle count correction' }).expect(409);
    expect(response.body.error.code).toBe('RECONCILIATION_REQUIRED');
    expect(pool.getConnection).not.toHaveBeenCalled();
    expect(pool.execute).not.toHaveBeenCalled();
  });

  test('legacy quick adjustment rejects cross-pharmacy requests before any write', async () => {
    const response = await request(app).post('/api/inventory/91/adjust').set('Cookie', cookie())
      .send({ pharmacyId: 999, delta: 3, reason: 'Cycle count correction' }).expect(403);
    expect(response.body.error.code).toBe('PHARMACY_FORBIDDEN');
    expect(pool.getConnection).not.toHaveBeenCalled();
    expect(pool.execute).not.toHaveBeenCalled();
  });

  test('supplier create remains limited to the session pharmacy', async () => {
    pool.execute.mockResolvedValueOnce([{ insertId: 7 }, []]);
    await request(app).post('/api/suppliers').set('Cookie', cookie()).send({ pharmacyId: 999, name: 'Fictional Medical Supply' }).expect(201);
    expect(pool.execute.mock.calls[0][0]).toContain('INSERT INTO suppliers');
    expect(pool.execute.mock.calls[0][1][0]).toBe(23);
    expect(pool.execute.mock.calls[0][1][1]).toBe('Fictional Medical Supply');
  });

  test('supplier update filters by the authenticated pharmacy', async () => {
    pool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await request(app).put('/api/suppliers/7').set('Cookie', cookie()).send({ name: 'Fictional Medical Supply Updated', isActive: true }).expect(200);
    expect(pool.execute.mock.calls[0][0]).toContain('WHERE id=? AND pharmacy_id=?');
    expect(pool.execute.mock.calls[0][1].slice(-2)).toEqual([7, 23]);
  });

  test('barcode lookup binds the current pharmacy and records scan history', async () => {
    pool.execute
      .mockResolvedValueOnce([[{ medicineId: 5, identifierId: 17, name: 'Fictional Relief', batchId: 91, quantityOnHand: 8, recalled: '0' }], []])
      .mockResolvedValueOnce([{ insertId: 66 }, []]);
    const response = await request(app).get('/api/lookup/barcode/TEST-001').set('Cookie', cookie('pharmacist', 23)).expect(200);
    expect(response.body.authenticityVerified).toBe(false);
    expect(response.body.data[0].recalled).toBe(false);
    expect(pool.execute.mock.calls[0][0]).toContain('b.pharmacy_id=?');
    expect(pool.execute.mock.calls[0][1]).toEqual([23, 'TEST-001']);
    expect(pool.execute.mock.calls[1][0]).toContain('INSERT INTO scan_history');
    expect(pool.execute.mock.calls[1][1][0]).toBe(23);
  });

  test('medicine batch details normalize string recall flags before returning them', async () => {
    pool.execute.mockResolvedValueOnce([[
      { id: '91', pharmacyId: '23', batchNumber: 'HV-PAR-2604', quantityOnHand: 9, recalled: '0' },
    ], []]);
    const response = await request(app).get('/api/medicines/5/batches').set('Cookie', cookie()).expect(200);
    expect(response.body.data[0].recalled).toBe(false);
    expect(pool.execute.mock.calls[0][1]).toEqual([5, 23]);
  });

  test('inventory CSV export is pharmacy scoped and neutralizes spreadsheet formulas', async () => {
    pool.execute.mockResolvedValueOnce([[
      { pharmacy: '=HYPERLINK("https://example.test")', medicine: 'Fictional Relief', strength: '250 mg', batchNumber: 'B-1', quantityOnHand: 9, reorderLevel: 3, expiryDate: '2027-06-30', purchasePrice: '4.00', sellingPrice: '8.00', supplier: 'Fictional Supply' },
    ], []]);
    const response = await request(app).get('/api/reports/inventory?format=csv&pharmacyId=999').set('Cookie', cookie('pharmacist', 23)).expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain("'=HYPERLINK");
    expect(pool.execute.mock.calls[0][0]).toContain('i.pharmacy_id=?');
    expect(pool.execute.mock.calls[0][1]).toEqual([23]);
  });
});
