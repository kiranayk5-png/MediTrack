const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { authenticate, allowRoles, pharmacyScope } = require('../middleware/auth');
const { AppError } = require('../lib/errors');
const { mysqlBoolean, mysqlBooleanOrFailClosed } = require('../lib/mysqlBoolean');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const search = String(req.query.search || '').trim().slice(0, 100);
    const params = [];
    let clauses = 'WHERE 1=1';
    if (pharmacyId) { clauses += ' AND i.pharmacy_id=?'; params.push(pharmacyId); }
    if (search) { clauses += ' AND (m.name LIKE ? OR m.generic_name LIKE ? OR b.batch_number LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM inventory i JOIN medicine_batches b ON b.id=i.batch_id AND b.pharmacy_id=i.pharmacy_id JOIN medicines m ON m.id=b.medicine_id ${clauses}`, params);
    const [rows] = await pool.execute(
      `SELECT i.id, i.pharmacy_id AS pharmacyId, i.batch_id AS batchId, i.quantity_on_hand AS quantityOnHand, i.reorder_level AS reorderLevel,
       b.batch_number AS batchNumber, b.expiry_date AS expiryDate, b.selling_price AS sellingPrice,
       m.id AS medicineId, m.name AS medicineName, m.strength, m.dosage_form AS dosageForm, s.name AS supplierName,
       (i.quantity_on_hand <= i.reorder_level) AS isLowStock,
       EXISTS(SELECT 1 FROM recall_records rr WHERE rr.pharmacy_id=b.pharmacy_id AND rr.medicine_id=b.medicine_id AND rr.status <> 'closed' AND (rr.batch_id IS NULL OR rr.batch_id=b.id)) AS isRecalled
       FROM inventory i JOIN medicine_batches b ON b.id=i.batch_id AND b.pharmacy_id=i.pharmacy_id
       JOIN medicines m ON m.id=b.medicine_id LEFT JOIN suppliers s ON s.id=b.supplier_id AND s.pharmacy_id=b.pharmacy_id
       ${clauses} ORDER BY (b.expiry_date < CURDATE()) DESC, b.expiry_date ASC, m.name LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    );
    res.json({
      data: rows.map((row) => ({
        ...row,
        isLowStock: mysqlBoolean(row.isLowStock) ?? true,
        isRecalled: mysqlBooleanOrFailClosed(row.isRecalled),
      })),
      pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) },
    });
  } catch (error) { next(error); }
});

router.get('/:batchId/history', async (req, res, next) => {
  try {
    const batchId = z.coerce.number().int().positive().parse(req.params.batchId);
    const pharmacyId = pharmacyScope(req);
    const params = [batchId];
    let pharmacy = '';
    if (pharmacyId) { pharmacy = ' AND h.pharmacy_id=?'; params.push(pharmacyId); }
    const [rows] = await pool.execute(`SELECT h.id, h.movement_type AS movementType, h.quantity_delta AS quantityDelta, h.quantity_after AS quantityAfter,
      h.reason, h.created_at AS createdAt, u.full_name AS userName FROM stock_history h LEFT JOIN users u ON u.id=h.user_id
      WHERE h.batch_id=?${pharmacy} ORDER BY h.created_at DESC LIMIT 100`, params);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.post('/:batchId/adjust', allowRoles('platform_admin', 'pharmacy_manager', 'inventory_clerk'), async (req, res, next) => {
  try {
    z.coerce.number().int().positive().safe().parse(req.params.batchId);
    z.object({ delta: z.number().int().safe().refine((value) => value !== 0), reason: z.string().trim().min(3).max(255), pharmacyId: z.number().int().positive().optional() }).parse(req.body);
    if (req.body?.pharmacyId && req.user.pharmacyId && Number(req.body.pharmacyId) !== Number(req.user.pharmacyId)) {
      throw new AppError(403, 'You can only adjust stock for your assigned pharmacy.', 'PHARMACY_FORBIDDEN');
    }
    const pharmacyId = pharmacyScope(req);
    if (!pharmacyId) throw new AppError(400, 'Select a pharmacy to start a reconciliation.', 'PHARMACY_REQUIRED');
    throw new AppError(409, 'Manual stock corrections require a reconciliation count and manager approval.', 'RECONCILIATION_REQUIRED');
  } catch (error) { next(error); }
});

module.exports = router;
