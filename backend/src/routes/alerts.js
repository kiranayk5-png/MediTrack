const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { authenticate, allowRoles, pharmacyScope } = require('../middleware/auth');
const { AppError } = require('../lib/errors');

const router = express.Router();
router.use(authenticate);

router.post('/recalls', allowRoles('platform_admin', 'pharmacy_manager'), async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const pharmacyId = pharmacyScope(req) || z.number().int().positive().parse(req.body.pharmacyId);
    const body = z.object({ medicineId: z.number().int().positive(), batchId: z.number().int().positive().nullable().optional(), recallNumber: z.string().trim().min(1).max(100), source: z.string().trim().max(150).nullable().optional(), reason: z.string().trim().min(5).max(5000), severity: z.enum(['low', 'medium', 'high', 'critical']).default('high'), issuedAt: z.string().datetime().optional() }).parse(req.body);
    await conn.beginTransaction();
    const [medicines] = await conn.execute('SELECT id FROM medicines WHERE id=?', [body.medicineId]);
    if (!medicines.length) throw new AppError(404, 'Medicine not found.', 'MEDICINE_NOT_FOUND');
    if (body.batchId) {
      const [batches] = await conn.execute('SELECT id FROM medicine_batches WHERE id=? AND medicine_id=? AND pharmacy_id=?', [body.batchId, body.medicineId, pharmacyId]);
      if (!batches.length) throw new AppError(400, 'The batch must belong to this medicine and pharmacy.', 'INVALID_BATCH_SCOPE');
    }
    const [result] = await conn.execute(`INSERT INTO recall_records (pharmacy_id,medicine_id,batch_id,recall_number,source,reason,severity,status,issued_at,created_by)
      VALUES (?,?,?,?,?,?,?,'active',?,?)`, [pharmacyId, body.medicineId, body.batchId ?? null, body.recallNumber, body.source ?? null, body.reason, body.severity, body.issuedAt ? new Date(body.issuedAt) : new Date(), req.user.id]);
    await conn.execute('INSERT INTO audit_logs (pharmacy_id,user_id,action,entity_type,entity_id,details) VALUES (?,?,\'recall.created\',\'recall_record\',?,?)', [pharmacyId, req.user.id, result.insertId, JSON.stringify({ recallNumber: body.recallNumber, severity: body.severity })]);
    await conn.commit();
    res.status(201).json({ id: result.insertId });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

router.get('/', async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const p = pharmacyId ? [pharmacyId] : [];
    const q = pharmacyId ? ' AND i.pharmacy_id=?' : '';
    const [expiry] = await pool.execute(`SELECT b.id AS batchId,b.pharmacy_id AS pharmacyId,b.batch_number AS batchNumber,b.expiry_date AS expiryDate,
      i.quantity_on_hand AS quantityOnHand,m.id AS medicineId,m.name AS medicineName,
      CASE WHEN b.expiry_date < CURDATE() THEN 'expired' ELSE 'expiring_soon' END AS alertType
      FROM medicine_batches b JOIN inventory i ON i.batch_id=b.id AND i.pharmacy_id=b.pharmacy_id JOIN medicines m ON m.id=b.medicine_id
      WHERE i.quantity_on_hand > 0 AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)${q} ORDER BY b.expiry_date`, p);
    const [lowStock] = await pool.execute(`SELECT i.pharmacy_id AS pharmacyId,b.id AS batchId,b.batch_number AS batchNumber,
      i.quantity_on_hand AS quantityOnHand,i.reorder_level AS reorderLevel,m.name AS medicineName,b.expiry_date AS expiryDate
      FROM inventory i JOIN medicine_batches b ON b.id=i.batch_id AND b.pharmacy_id=i.pharmacy_id JOIN medicines m ON m.id=b.medicine_id
      WHERE i.quantity_on_hand <= i.reorder_level${q} ORDER BY (i.quantity_on_hand=0) DESC,i.quantity_on_hand ASC`, p);
    const [recalls] = await pool.execute(`SELECT rr.id,rr.pharmacy_id AS pharmacyId,rr.recall_number AS recallNumber,rr.severity,rr.status,rr.issued_at AS issuedAt,rr.reason,
      m.name AS medicineName,b.batch_number AS batchNumber FROM recall_records rr JOIN medicines m ON m.id=rr.medicine_id
      LEFT JOIN medicine_batches b ON b.id=rr.batch_id AND b.pharmacy_id=rr.pharmacy_id WHERE rr.status <> 'closed'${pharmacyId ? ' AND rr.pharmacy_id=?' : ''} ORDER BY rr.issued_at DESC`, p);
    const [tracked] = await pool.execute(`SELECT id,pharmacy_id AS pharmacyId,batch_id AS batchId,alert_type AS alertType,status,triggered_at AS triggeredAt
      FROM expiry_alerts WHERE status IN ('open','acknowledged')${pharmacyId ? ' AND pharmacy_id=?' : ''} ORDER BY triggered_at DESC`, p);
    res.json({ expiry, lowStock, recalls, trackedExpiryAlerts: tracked });
  } catch (error) { next(error); }
});

router.patch('/:alertId', allowRoles('platform_admin', 'pharmacy_manager', 'pharmacist'), async (req, res, next) => {
  try {
    const alertId = z.coerce.number().int().positive().parse(req.params.alertId);
    const { status } = z.object({ status: z.enum(['acknowledged', 'resolved', 'dismissed']) }).parse(req.body);
    const pharmacyId = pharmacyScope(req);
    const params = [status, status === 'acknowledged' ? req.user.id : null, status === 'acknowledged' ? new Date() : null, status === 'resolved' ? new Date() : null, alertId];
    let scope = '';
    if (pharmacyId) { scope = ' AND pharmacy_id=?'; params.push(pharmacyId); }
    const [result] = await pool.execute(`UPDATE expiry_alerts SET status=?,acknowledged_by=COALESCE(?,acknowledged_by),acknowledged_at=COALESCE(?,acknowledged_at),resolved_at=COALESCE(?,resolved_at) WHERE id=?${scope}`, params);
    if (!result.affectedRows) throw new AppError(404, 'Expiry alert not found.', 'NOT_FOUND');
    res.json({ message: 'Alert status updated.' });
  } catch (error) { next(error); }
});

module.exports = router;
