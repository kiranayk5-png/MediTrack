const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { authenticate, allowRoles, pharmacyScope } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { AppError } = require('../lib/errors');
const { mysqlBooleanOrFailClosed } = require('../lib/mysqlBoolean');

const router = express.Router();
const id = z.coerce.number().int().positive();
const medicineSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(200), genericName: z.string().trim().max(200).nullable().optional(), brandName: z.string().trim().max(150).nullable().optional(),
    strength: z.string().trim().max(100).nullable().optional(), dosageForm: z.string().trim().max(80).nullable().optional(), route: z.string().trim().max(80).nullable().optional(),
    manufacturer: z.string().trim().max(200).nullable().optional(), prescriptionRequired: z.boolean().optional(), description: z.string().max(5000).nullable().optional(), isActive: z.boolean().optional(),
  }), query: z.any(), params: z.any(),
});

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim().slice(0, 100);
    const params = [];
    const where = ['m.is_active IN (0, 1)'];
    if (search) {
      where.push('(m.name LIKE ? OR m.generic_name LIKE ? OR m.brand_name LIKE ? OR m.manufacturer LIKE ? OR EXISTS (SELECT 1 FROM medicine_identifiers mi WHERE mi.medicine_id = m.id AND mi.identifier_value LIKE ?))');
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }
    const whereSql = where.join(' AND ');
    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM medicines m WHERE ${whereSql}`, params);
    const [rows] = await pool.execute(
      `SELECT m.id, m.name, m.generic_name AS genericName, m.brand_name AS brandName, m.strength, m.dosage_form AS dosageForm,
              m.route, m.manufacturer, m.prescription_required AS prescriptionRequired, m.description, m.is_active AS isActive,
              (SELECT GROUP_CONCAT(CONCAT(mi.identifier_type, ':', mi.identifier_value) ORDER BY mi.is_primary DESC SEPARATOR ', ')
               FROM medicine_identifiers mi WHERE mi.medicine_id = m.id) AS identifiers
       FROM medicines m WHERE ${whereSql} ORDER BY m.name LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    res.json({ data: rows, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } });
  } catch (error) { next(error); }
});

router.get('/:medicineId/batches', async (req, res, next) => {
  try {
    const medicineId = id.parse(req.params.medicineId);
    const pharmacyId = pharmacyScope(req);
    const params = [medicineId];
    let pharmacyClause = '';
    if (pharmacyId) { pharmacyClause = ' AND b.pharmacy_id = ?'; params.push(pharmacyId); }
    const [rows] = await pool.execute(
      `SELECT b.id, b.pharmacy_id AS pharmacyId, b.batch_number AS batchNumber, b.expiry_date AS expiryDate, b.manufacture_date AS manufactureDate,
              b.purchase_price AS purchasePrice, b.selling_price AS sellingPrice, s.name AS supplierName,
              COALESCE(i.quantity_on_hand, 0) AS quantityOnHand, COALESCE(i.reorder_level, 0) AS reorderLevel,
              EXISTS(SELECT 1 FROM recall_records rr WHERE rr.medicine_id = b.medicine_id AND rr.status <> 'closed'
                     AND (rr.batch_id IS NULL OR rr.batch_id = b.id) AND rr.pharmacy_id = b.pharmacy_id) AS recalled
       FROM medicine_batches b LEFT JOIN inventory i ON i.batch_id = b.id AND i.pharmacy_id = b.pharmacy_id
       LEFT JOIN suppliers s ON s.id = b.supplier_id AND s.pharmacy_id = b.pharmacy_id
       WHERE b.medicine_id = ?${pharmacyClause} ORDER BY b.expiry_date, b.id`, params,
    );
    res.json({ data: rows.map((row) => ({ ...row, recalled: mysqlBooleanOrFailClosed(row.recalled) })) });
  } catch (error) { next(error); }
});

router.get('/:medicineId', async (req, res, next) => {
  try {
    const medicineId = id.parse(req.params.medicineId);
    const [rows] = await pool.execute('SELECT id, name, generic_name AS genericName, brand_name AS brandName, strength, dosage_form AS dosageForm, route, manufacturer, prescription_required AS prescriptionRequired, description, is_active AS isActive FROM medicines WHERE id = ?', [medicineId]);
    if (!rows.length) throw new AppError(404, 'Medicine not found.', 'NOT_FOUND');
    const [identifiers] = await pool.execute('SELECT id, identifier_type AS identifierType, identifier_value AS identifierValue, is_primary AS isPrimary FROM medicine_identifiers WHERE medicine_id = ? ORDER BY is_primary DESC, id', [medicineId]);
    res.json({ ...rows[0], identifiers });
  } catch (error) { next(error); }
});

router.post('/', allowRoles('platform_admin', 'pharmacy_manager'), validate(medicineSchema), async (req, res, next) => {
  try {
    const b = req.validated.body;
    const [result] = await pool.execute(
      `INSERT INTO medicines (name, generic_name, brand_name, strength, dosage_form, route, manufacturer, prescription_required, description, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.name, b.genericName ?? null, b.brandName ?? null, b.strength ?? null, b.dosageForm ?? null, b.route ?? null, b.manufacturer ?? null, b.prescriptionRequired ?? false, b.description ?? null, b.isActive ?? true],
    );
    res.status(201).json({ id: result.insertId });
  } catch (error) { next(error); }
});

router.put('/:medicineId', allowRoles('platform_admin', 'pharmacy_manager'), validate(medicineSchema), async (req, res, next) => {
  try {
    const medicineId = id.parse(req.params.medicineId);
    const b = req.validated.body;
    const [result] = await pool.execute(
      `UPDATE medicines SET name = ?, generic_name = ?, brand_name = ?, strength = ?, dosage_form = ?, route = ?, manufacturer = ?,
       prescription_required = ?, description = ?, is_active = ? WHERE id = ?`,
      [b.name, b.genericName ?? null, b.brandName ?? null, b.strength ?? null, b.dosageForm ?? null, b.route ?? null, b.manufacturer ?? null, b.prescriptionRequired ?? false, b.description ?? null, b.isActive ?? true, medicineId],
    );
    if (!result.affectedRows) throw new AppError(404, 'Medicine not found.', 'NOT_FOUND');
    res.json({ message: 'Medicine updated.' });
  } catch (error) { next(error); }
});

router.post('/:medicineId/identifiers', allowRoles('platform_admin', 'pharmacy_manager'), async (req, res, next) => {
  try {
    const medicineId = id.parse(req.params.medicineId);
    const body = z.object({ identifierType: z.enum(['barcode', 'gtin', 'national_code', 'internal_code', 'other']), identifierValue: z.string().trim().min(1).max(100), isPrimary: z.boolean().default(false) }).parse(req.body);
    const [result] = await pool.execute('INSERT INTO medicine_identifiers (medicine_id, identifier_type, identifier_value, is_primary) VALUES (?, ?, ?, ?)', [medicineId, body.identifierType, body.identifierValue, body.isPrimary]);
    res.status(201).json({ id: result.insertId });
  } catch (error) { next(error); }
});

router.post('/:medicineId/batches', allowRoles('platform_admin', 'pharmacy_manager', 'inventory_clerk'), async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const medicineId = id.parse(req.params.medicineId);
    const pharmacyId = pharmacyScope(req);
    if (!pharmacyId) throw new AppError(400, 'Select a pharmacy for batch receiving.', 'PHARMACY_REQUIRED');
    const body = z.object({ supplierId: z.number().int().positive().nullable().optional(), batchNumber: z.string().trim().min(1).max(100), manufactureDate: z.string().date().nullable().optional(), expiryDate: z.string().date(), purchasePrice: z.number().nonnegative(), sellingPrice: z.number().nonnegative(), quantity: z.number().int().positive(), reorderLevel: z.number().int().nonnegative().default(0) }).parse(req.body);
    await conn.beginTransaction();
    const [batches] = await conn.execute(
      'INSERT INTO medicine_batches (pharmacy_id, medicine_id, supplier_id, batch_number, manufacture_date, expiry_date, purchase_price, selling_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [pharmacyId, medicineId, body.supplierId ?? null, body.batchNumber, body.manufactureDate ?? null, body.expiryDate, body.purchasePrice, body.sellingPrice],
    );
    await conn.execute('INSERT INTO inventory (pharmacy_id, batch_id, quantity_on_hand, reorder_level) VALUES (?, ?, ?, ?)', [pharmacyId, batches.insertId, body.quantity, body.reorderLevel]);
    await conn.execute('INSERT INTO stock_history (pharmacy_id, batch_id, user_id, movement_type, quantity_delta, quantity_after, reason) VALUES (?, ?, ?, \'received\', ?, ?, \'Initial batch receipt\')', [pharmacyId, batches.insertId, req.user.id, body.quantity, body.quantity]);
    await conn.commit();
    res.status(201).json({ id: batches.insertId });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

module.exports = router;
