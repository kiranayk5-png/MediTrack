const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { authenticate, allowRoles, pharmacyScope } = require('../middleware/auth');
const { AppError } = require('../lib/errors');

const router = express.Router();
router.use(authenticate);

const supplierSchema = z.object({ name: z.string().trim().min(1).max(180), contactName: z.string().trim().max(150).nullable().optional(), email: z.string().email().max(254).nullable().optional(), phone: z.string().max(30).nullable().optional(), address: z.string().max(2000).nullable().optional(), isActive: z.boolean().optional() });

router.get('/', async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const params = [];
    let clause = '';
    if (pharmacyId) { clause = 'WHERE s.pharmacy_id=?'; params.push(pharmacyId); }
    const [rows] = await pool.execute(`SELECT s.id, s.pharmacy_id AS pharmacyId, s.name, s.contact_name AS contactName, s.email, s.phone, s.address, s.is_active AS isActive, COUNT(b.id) AS batchCount
      FROM suppliers s LEFT JOIN medicine_batches b ON b.supplier_id=s.id AND b.pharmacy_id=s.pharmacy_id ${clause}
      GROUP BY s.id ORDER BY s.name`, params);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.post('/', allowRoles('platform_admin', 'pharmacy_manager'), async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req) || z.number().int().positive().parse(req.body.pharmacyId);
    const body = supplierSchema.parse(req.body);
    const [result] = await pool.execute('INSERT INTO suppliers (pharmacy_id,name,contact_name,email,phone,address,is_active) VALUES (?,?,?,?,?,?,?)', [pharmacyId, body.name, body.contactName ?? null, body.email ?? null, body.phone ?? null, body.address ?? null, body.isActive ?? true]);
    res.status(201).json({ id: result.insertId });
  } catch (error) { next(error); }
});

router.put('/:supplierId', allowRoles('platform_admin', 'pharmacy_manager'), async (req, res, next) => {
  try {
    const supplierId = z.coerce.number().int().positive().parse(req.params.supplierId);
    const pharmacyId = pharmacyScope(req);
    const body = supplierSchema.parse(req.body);
    const [result] = await pool.execute(`UPDATE suppliers SET name=?,contact_name=?,email=?,phone=?,address=?,is_active=? WHERE id=?${pharmacyId ? ' AND pharmacy_id=?' : ''}`,
      [...[body.name, body.contactName ?? null, body.email ?? null, body.phone ?? null, body.address ?? null, body.isActive ?? true, supplierId], ...(pharmacyId ? [pharmacyId] : [])]);
    if (!result.affectedRows) throw new AppError(404, 'Supplier not found for this pharmacy.', 'NOT_FOUND');
    res.json({ message: 'Supplier updated.' });
  } catch (error) { next(error); }
});

module.exports = router;
