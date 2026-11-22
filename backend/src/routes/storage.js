const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { authenticate, allowRoles, pharmacyScope } = require('../middleware/auth');
const { AppError } = require('../lib/errors');
const { mysqlBoolean } = require('../lib/mysqlBoolean');
const { writeAudit } = require('../lib/audit');

const router = express.Router();
router.use(authenticate);
const id = z.number().int().positive().safe();
const nullableRange = z.number().finite().nullable().optional();
const conditionStatuses = ['normal', 'damaged_packaging', 'contamination', 'power_outage', 'other'];

function storagePharmacy(req, supplied) {
  const scope = pharmacyScope(req);
  if (scope && supplied && Number(supplied) !== Number(scope)) throw new AppError(403, 'You can only access storage records for your pharmacy.', 'PHARMACY_FORBIDDEN');
  const pharmacyId = scope || supplied;
  if (!pharmacyId) throw new AppError(400, 'Select a pharmacy to access storage records.', 'PHARMACY_REQUIRED');
  return Number(pharmacyId);
}

router.get('/policy', async (req, res, next) => {
  try {
    const pharmacyId = storagePharmacy(req, req.query.pharmacyId ? Number(req.query.pharmacyId) : undefined);
    const [rows] = await pool.execute(
      `SELECT pharmacy_id AS pharmacyId,min_temperature_c AS minTemperatureC,max_temperature_c AS maxTemperatureC,
              min_humidity_percent AS minHumidityPercent,max_humidity_percent AS maxHumidityPercent,updated_by AS updatedBy,updated_at AS updatedAt
       FROM storage_policies WHERE pharmacy_id=?`, [pharmacyId],
    );
    res.json({ data: rows[0] || null });
  } catch (error) { next(error); }
});

router.put('/policy', allowRoles('platform_admin', 'pharmacy_manager'), async (req, res, next) => {
  let conn;
  try {
    const body = z.object({
      pharmacyId: id.optional(), minTemperatureC: nullableRange.refine((v) => v == null || (v >= -80 && v <= 100)),
      maxTemperatureC: nullableRange.refine((v) => v == null || (v >= -80 && v <= 100)),
      minHumidityPercent: nullableRange.refine((v) => v == null || (v >= 0 && v <= 100)),
      maxHumidityPercent: nullableRange.refine((v) => v == null || (v >= 0 && v <= 100)),
    }).superRefine((value, ctx) => {
      const tempSet = value.minTemperatureC != null && value.maxTemperatureC != null;
      const tempPartial = (value.minTemperatureC == null) !== (value.maxTemperatureC == null);
      const humiditySet = value.minHumidityPercent != null && value.maxHumidityPercent != null;
      const humidityPartial = (value.minHumidityPercent == null) !== (value.maxHumidityPercent == null);
      if (tempPartial) ctx.addIssue({ code: 'custom', path: ['minTemperatureC'], message: 'Enter both temperature limits or leave both blank.' });
      if (humidityPartial) ctx.addIssue({ code: 'custom', path: ['minHumidityPercent'], message: 'Enter both humidity limits or leave both blank.' });
      if (!tempSet && !humiditySet) ctx.addIssue({ code: 'custom', path: ['minTemperatureC'], message: 'Configure at least one complete range.' });
      if (tempSet && value.minTemperatureC > value.maxTemperatureC) ctx.addIssue({ code: 'custom', path: ['minTemperatureC'], message: 'Minimum temperature must not exceed maximum.' });
      if (humiditySet && value.minHumidityPercent > value.maxHumidityPercent) ctx.addIssue({ code: 'custom', path: ['minHumidityPercent'], message: 'Minimum humidity must not exceed maximum.' });
    }).parse(req.body);
    const pharmacyId = storagePharmacy(req, body.pharmacyId);
    const [active] = await pool.execute('SELECT id FROM pharmacies WHERE id=? AND is_active=TRUE', [pharmacyId]);
    if (!active.length) throw new AppError(400, 'Choose an active pharmacy.', 'INVALID_PHARMACY');
    conn = await pool.getConnection(); await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO storage_policies (pharmacy_id,min_temperature_c,max_temperature_c,min_humidity_percent,max_humidity_percent,updated_by)
       VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE min_temperature_c=VALUES(min_temperature_c),max_temperature_c=VALUES(max_temperature_c),
       min_humidity_percent=VALUES(min_humidity_percent),max_humidity_percent=VALUES(max_humidity_percent),updated_by=VALUES(updated_by)`,
      [pharmacyId, body.minTemperatureC ?? null, body.maxTemperatureC ?? null, body.minHumidityPercent ?? null, body.maxHumidityPercent ?? null, req.user.id],
    );
    await writeAudit(conn, { pharmacyId, userId: req.user.id, action: 'storage.policy_updated', entityType: 'storage_policy', entityId: pharmacyId, details: { temperatureConfigured: body.minTemperatureC != null, humidityConfigured: body.minHumidityPercent != null } });
    await conn.commit(); res.json({ pharmacyId, message: 'Storage ranges saved.' });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

router.get('/', async (req, res, next) => {
  try {
    const pharmacyId = storagePharmacy(req, req.query.pharmacyId ? Number(req.query.pharmacyId) : undefined);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const alertFilter = req.query.alertsOnly === 'true' ? " AND (sl.is_within_range=FALSE OR sc.condition_status <> 'normal')" : '';
    const [rows] = await pool.execute(
      `SELECT sl.id,sl.pharmacy_id AS pharmacyId,sl.batch_id AS batchId,b.batch_number AS batchNumber,m.name AS medicineName,
              sl.temperature_c AS temperatureC,sl.humidity_percent AS humidityPercent,sl.is_within_range AS isWithinRange,
              sl.notes,sl.recorded_at AS recordedAt,sl.recorded_by AS recordedBy,u.full_name AS recordedByName,
              sc.condition_status AS conditionStatus,sc.condition_notes AS conditionNotes
       FROM storage_logs sl LEFT JOIN medicine_batches b ON b.id=sl.batch_id AND b.pharmacy_id=sl.pharmacy_id
       LEFT JOIN medicines m ON m.id=b.medicine_id LEFT JOIN users u ON u.id=sl.recorded_by
       LEFT JOIN storage_condition_details sc ON sc.storage_log_id=sl.id
       WHERE sl.pharmacy_id=?${alertFilter} ORDER BY sl.recorded_at DESC,sl.id DESC LIMIT ? OFFSET ?`,
      [pharmacyId, limit, (page - 1) * limit],
    );
    res.json({ data: rows.map((row) => ({ ...row, isWithinRange: row.isWithinRange == null ? null : mysqlBoolean(row.isWithinRange) })) });
  } catch (error) { next(error); }
});

router.post('/', allowRoles('platform_admin', 'pharmacy_manager', 'pharmacist', 'inventory_clerk'), async (req, res, next) => {
  let conn;
  try {
    const body = z.object({
      pharmacyId: id.optional(), batchId: id.nullable().optional(), temperatureC: z.number().finite().min(-100).max(150).nullable().optional(),
      humidityPercent: z.number().finite().min(0).max(100).nullable().optional(), conditionStatus: z.enum(conditionStatuses).default('normal'),
      conditionNotes: z.string().trim().max(500).nullable().optional(), notes: z.string().trim().max(500).nullable().optional(),
    }).superRefine((value, ctx) => {
      if (value.temperatureC == null && value.humidityPercent == null && !value.conditionNotes?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['temperatureC'], message: 'Record a reading or describe the storage condition.' });
      }
      if (value.conditionStatus !== 'normal' && !value.conditionNotes?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['conditionNotes'], message: 'Describe the non-normal condition.' });
      }
    }).parse(req.body);
    const pharmacyId = storagePharmacy(req, body.pharmacyId);
    conn = await pool.getConnection(); await conn.beginTransaction();
    if (body.batchId) {
      const [batches] = await conn.execute('SELECT id FROM medicine_batches WHERE id=? AND pharmacy_id=?', [body.batchId, pharmacyId]);
      if (!batches.length) throw new AppError(400, 'The selected batch does not belong to this pharmacy.', 'INVALID_BATCH_SCOPE');
    }
    const [policies] = await conn.execute(
      `SELECT min_temperature_c AS minTemperatureC,max_temperature_c AS maxTemperatureC,
              min_humidity_percent AS minHumidityPercent,max_humidity_percent AS maxHumidityPercent
       FROM storage_policies WHERE pharmacy_id=? FOR UPDATE`, [pharmacyId],
    );
    const policy = policies[0];
    let outOfRange = body.conditionStatus !== 'normal';
    let unevaluated = false;
    let evaluated = false;
    if (body.temperatureC != null) {
      if (policy?.minTemperatureC != null && policy?.maxTemperatureC != null) {
        evaluated = true;
        if (body.temperatureC < Number(policy.minTemperatureC) || body.temperatureC > Number(policy.maxTemperatureC)) outOfRange = true;
      } else unevaluated = true;
    }
    if (body.humidityPercent != null) {
      if (policy?.minHumidityPercent != null && policy?.maxHumidityPercent != null) {
        evaluated = true;
        if (body.humidityPercent < Number(policy.minHumidityPercent) || body.humidityPercent > Number(policy.maxHumidityPercent)) outOfRange = true;
      } else unevaluated = true;
    }
    const isWithinRange = outOfRange ? false : (evaluated && !unevaluated ? true : null);
    const [result] = await conn.execute(
      `INSERT INTO storage_logs (pharmacy_id,batch_id,recorded_by,temperature_c,humidity_percent,is_within_range,notes)
       VALUES (?,?,?,?,?,?,?)`,
      [pharmacyId, body.batchId ?? null, req.user.id, body.temperatureC ?? null, body.humidityPercent ?? null, isWithinRange, body.notes ?? null],
    );
    await conn.execute(
      'INSERT INTO storage_condition_details (storage_log_id,condition_status,condition_notes) VALUES (?,?,?)',
      [result.insertId, body.conditionStatus, body.conditionNotes ?? null],
    );
    await writeAudit(conn, { pharmacyId, userId: req.user.id, action: 'storage.log_created', entityType: 'storage_log', entityId: result.insertId, details: { batchId: body.batchId ?? null, isWithinRange, conditionStatus: body.conditionStatus } });
    await conn.commit();
    res.status(201).json({ id: result.insertId, isWithinRange, alert: isWithinRange === false || body.conditionStatus !== 'normal', thresholdsConfigured: Boolean(policy) });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

module.exports = router;
