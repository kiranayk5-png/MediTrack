const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { authenticate, allowRoles, pharmacyScope } = require('../middleware/auth');
const { AppError } = require('../lib/errors');
const { writeAudit } = require('../lib/audit');
const { REASON_CODES, calculateDiscrepancy, splitHistoryDeltas } = require('../lib/reconciliation');

const router = express.Router();
router.use(authenticate);

const id = z.number().int().positive().safe();
const countRoles = ['platform_admin', 'pharmacy_manager', 'pharmacist', 'inventory_clerk'];
const reviewerRoles = ['platform_admin', 'pharmacy_manager'];

function resolvePharmacy(req, supplied, required = false) {
  const scope = pharmacyScope(req);
  if (scope && supplied != null && Number(supplied) !== Number(scope)) {
    throw new AppError(403, 'You can only reconcile stock for your assigned pharmacy.', 'PHARMACY_FORBIDDEN');
  }
  const pharmacyId = scope || supplied;
  if (required && !pharmacyId) throw new AppError(400, 'Select a pharmacy to start a reconciliation.', 'PHARMACY_REQUIRED');
  return pharmacyId ? Number(pharmacyId) : null;
}

async function lockedSession(conn, sessionId) {
  const [rows] = await conn.execute(
    `SELECT id,pharmacy_id AS pharmacyId,status,created_by AS createdBy
     FROM inventory_reconciliation_sessions WHERE id=? FOR UPDATE`, [sessionId],
  );
  if (!rows.length) throw new AppError(404, 'Reconciliation session was not found.', 'RECONCILIATION_NOT_FOUND');
  return rows[0];
}

function enforceSessionScope(req, session) {
  const pharmacyId = pharmacyScope(req);
  if (pharmacyId && Number(session.pharmacyId) !== Number(pharmacyId)) {
    throw new AppError(404, 'Reconciliation session was not found.', 'RECONCILIATION_NOT_FOUND');
  }
}

function assertCountComplete(items) {
  for (const item of items) {
    if (item.physicalQuantity == null) {
      throw new AppError(400, `Enter a physical count for batch ${item.batchNumber}.`, 'COUNT_INCOMPLETE');
    }
    const discrepancy = calculateDiscrepancy(item.physicalQuantity, item.systemQuantity);
    if (discrepancy !== 0 && !item.reasonCode) {
      throw new AppError(400, `Choose a reason for the discrepancy on batch ${item.batchNumber}.`, 'REASON_REQUIRED');
    }
    if (item.reasonCode === 'other' && !item.reasonExplanation?.trim()) {
      throw new AppError(400, `Explain the “other” reason for batch ${item.batchNumber}.`, 'EXPLANATION_REQUIRED');
    }
  }
}

router.get('/', async (req, res, next) => {
  try {
    const query = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'stale']).optional(),
      pharmacyId: z.coerce.number().int().positive().safe().optional(),
    }).parse(req.query);
    const pharmacyId = resolvePharmacy(req, query.pharmacyId);
    const clauses = [];
    const params = [];
    if (pharmacyId) { clauses.push('s.pharmacy_id=?'); params.push(pharmacyId); }
    if (query.status) { clauses.push('s.status=?'); params.push(query.status); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.limit;
    const [[{ total }], [rows]] = await Promise.all([
      pool.execute(`SELECT COUNT(*) AS total FROM inventory_reconciliation_sessions s ${where}`, params),
      pool.execute(
        `SELECT s.id,s.pharmacy_id AS pharmacyId,p.name AS pharmacy,s.status,s.created_by AS createdBy,
                creator.full_name AS createdByName,s.submitted_at AS submittedAt,s.reviewed_by AS reviewedBy,
                reviewer.full_name AS reviewedByName,s.reviewed_at AS reviewedAt,s.review_note AS reviewNote,
                s.created_at AS createdAt,s.updated_at AS updatedAt,
                COALESCE(summary.itemCount,0) AS itemCount,COALESCE(summary.countedCount,0) AS countedCount,
                COALESCE(summary.discrepancyCount,0) AS discrepancyCount,COALESCE(summary.discrepancyUnits,0) AS discrepancyUnits
         FROM inventory_reconciliation_sessions s JOIN pharmacies p ON p.id=s.pharmacy_id
         JOIN users creator ON creator.id=s.created_by LEFT JOIN users reviewer ON reviewer.id=s.reviewed_by
         LEFT JOIN (SELECT session_id,COUNT(*) AS itemCount,SUM(physical_quantity IS NOT NULL) AS countedCount,
                           SUM(discrepancy IS NOT NULL AND discrepancy<>0) AS discrepancyCount,
                           SUM(ABS(COALESCE(discrepancy,0))) AS discrepancyUnits
                    FROM inventory_reconciliation_items GROUP BY session_id) summary ON summary.session_id=s.id
         ${where} ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?`, [...params, query.limit, offset],
      ),
    ]);
    res.json({ data: rows, pagination: { page: query.page, limit: query.limit, total: Number(total), pages: Math.ceil(Number(total) / query.limit) } });
  } catch (error) { next(error); }
});

router.post('/', allowRoles(...countRoles), async (req, res, next) => {
  let conn;
  try {
    const body = z.object({
      pharmacyId: id.optional(),
      batchIds: z.array(id).min(1).max(2000).optional(),
    }).parse(req.body || {});
    if (body.batchIds && new Set(body.batchIds).size !== body.batchIds.length) {
      throw new AppError(400, 'A batch can only appear once in a count session.', 'DUPLICATE_BATCH');
    }
    const pharmacyId = resolvePharmacy(req, body.pharmacyId, true);
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [pharmacies] = await conn.execute('SELECT id FROM pharmacies WHERE id=? AND is_active=TRUE FOR UPDATE', [pharmacyId]);
    if (!pharmacies.length) throw new AppError(400, 'Choose an active pharmacy.', 'INVALID_PHARMACY');
    const [sessionResult] = await conn.execute(
      `INSERT INTO inventory_reconciliation_sessions (pharmacy_id,created_by,status) VALUES (?,?,'draft')`,
      [pharmacyId, req.user.id],
    );
    const sessionId = sessionResult.insertId;
    const batchFilter = body.batchIds ? ` AND i.batch_id IN (${body.batchIds.map(() => '?').join(',')})` : '';
    const [insertResult] = await conn.execute(
      `INSERT INTO inventory_reconciliation_items
         (session_id,pharmacy_id,batch_id,system_quantity,system_updated_at,system_history_id)
       SELECT ?,i.pharmacy_id,i.batch_id,i.quantity_on_hand,i.updated_at,
              (SELECT MAX(h.id) FROM stock_history h WHERE h.pharmacy_id=i.pharmacy_id AND h.batch_id=i.batch_id)
       FROM inventory i WHERE i.pharmacy_id=?${batchFilter} ORDER BY i.batch_id`, [sessionId, pharmacyId, ...(body.batchIds || [])],
    );
    if (!insertResult.affectedRows && body.batchIds) {
      throw new AppError(404, 'One or more selected batches are not available at this pharmacy.', 'INVALID_RECONCILIATION_ITEM');
    }
    if (!insertResult.affectedRows) throw new AppError(409, 'This pharmacy has no inventory batches to count.', 'NO_INVENTORY');
    if (body.batchIds && insertResult.affectedRows !== body.batchIds.length) {
      throw new AppError(404, 'One or more selected batches are not available at this pharmacy.', 'INVALID_RECONCILIATION_ITEM');
    }
    await writeAudit(conn, { pharmacyId, userId: req.user.id, action: 'inventory.reconciliation.started', entityType: 'inventory_reconciliation', entityId: sessionId });
    await conn.commit();
    res.status(201).json({ id: sessionId, pharmacyId, status: 'draft', itemCount: insertResult.affectedRows });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

router.get('/:sessionId', async (req, res, next) => {
  try {
    const sessionId = z.coerce.number().int().positive().safe().parse(req.params.sessionId);
    const pharmacyId = resolvePharmacy(req, req.query.pharmacyId ? Number(req.query.pharmacyId) : undefined);
    const [sessions] = await pool.execute(
      `SELECT s.id,s.pharmacy_id AS pharmacyId,p.name AS pharmacy,s.status,s.created_by AS createdBy,
              creator.full_name AS createdByName,s.submitted_at AS submittedAt,s.reviewed_by AS reviewedBy,
              reviewer.full_name AS reviewedByName,s.reviewed_at AS reviewedAt,s.review_note AS reviewNote,
              s.created_at AS createdAt,s.updated_at AS updatedAt
       FROM inventory_reconciliation_sessions s JOIN pharmacies p ON p.id=s.pharmacy_id
       JOIN users creator ON creator.id=s.created_by LEFT JOIN users reviewer ON reviewer.id=s.reviewed_by
       WHERE s.id=?${pharmacyId ? ' AND s.pharmacy_id=?' : ''}`,
      pharmacyId ? [sessionId, pharmacyId] : [sessionId],
    );
    if (!sessions.length) throw new AppError(404, 'Reconciliation session was not found.', 'RECONCILIATION_NOT_FOUND');
    const [items] = await pool.execute(
      `SELECT ri.id,ri.batch_id AS batchId,b.batch_number AS batchNumber,b.expiry_date AS expiryDate,
              m.id AS medicineId,m.name AS medicineName,m.strength,m.dosage_form AS dosageForm,
              ri.system_quantity AS systemQuantity,ri.physical_quantity AS physicalQuantity,
              ri.discrepancy,ri.reason_code AS reasonCode,ri.reason_explanation AS reasonExplanation,
              ri.system_updated_at AS systemUpdatedAt,ri.system_history_id AS systemHistoryId,
              i.quantity_on_hand AS currentQuantity
       FROM inventory_reconciliation_items ri JOIN medicine_batches b ON b.id=ri.batch_id AND b.pharmacy_id=ri.pharmacy_id
       JOIN medicines m ON m.id=b.medicine_id LEFT JOIN inventory i ON i.pharmacy_id=ri.pharmacy_id AND i.batch_id=ri.batch_id
       WHERE ri.session_id=? AND ri.pharmacy_id=? ORDER BY m.name,b.expiry_date,b.batch_number`,
      [sessionId, sessions[0].pharmacyId],
    );
    res.json({ data: { ...sessions[0], items, summary: {
      itemCount: items.length, countedCount: items.filter((item) => item.physicalQuantity != null).length,
      discrepancyCount: items.filter((item) => item.discrepancy != null && Number(item.discrepancy) !== 0).length,
      discrepancyUnits: items.reduce((sum, item) => sum + Math.abs(Number(item.discrepancy || 0)), 0),
    } } });
  } catch (error) { next(error); }
});

router.put('/:sessionId/items', allowRoles(...countRoles), async (req, res, next) => {
  let conn;
  try {
    const sessionId = z.coerce.number().int().positive().safe().parse(req.params.sessionId);
    const body = z.object({ items: z.array(z.object({
      batchId: id, physicalQuantity: z.number().int().min(0).max(4294967295).nullable(),
      reasonCode: z.enum(REASON_CODES).nullable().optional(), reasonExplanation: z.string().trim().max(220).nullable().optional(),
    })).min(1).max(2000) }).parse(req.body);
    const batchIds = body.items.map((item) => item.batchId);
    if (new Set(batchIds).size !== batchIds.length) throw new AppError(400, 'A batch can only appear once in a count update.', 'DUPLICATE_BATCH');
    conn = await pool.getConnection(); await conn.beginTransaction();
    const session = await lockedSession(conn, sessionId); enforceSessionScope(req, session);
    if (session.status !== 'draft') throw new AppError(409, 'Only draft reconciliation sessions can be edited.', 'INVALID_RECONCILIATION_STATE');
    if (Number(session.createdBy) !== Number(req.user.id)) throw new AppError(403, 'Only the staff member who started this draft can edit it.', 'RECONCILIATION_OWNER_REQUIRED');
    const placeholders = batchIds.map(() => '?').join(',');
    const [knownItems] = await conn.execute(
      `SELECT batch_id AS batchId FROM inventory_reconciliation_items WHERE session_id=? AND pharmacy_id=? AND batch_id IN (${placeholders}) FOR UPDATE`,
      [sessionId, session.pharmacyId, ...batchIds],
    );
    if (knownItems.length !== batchIds.length) throw new AppError(400, 'One or more batches do not belong to this reconciliation.', 'INVALID_RECONCILIATION_ITEM');
    for (const item of body.items) {
      await conn.execute(
        `UPDATE inventory_reconciliation_items SET physical_quantity=?,reason_code=?,reason_explanation=?
         WHERE session_id=? AND pharmacy_id=? AND batch_id=?`,
        [item.physicalQuantity, item.reasonCode ?? null, item.reasonExplanation ?? null, sessionId, session.pharmacyId, item.batchId],
      );
    }
    await conn.execute('UPDATE inventory_reconciliation_sessions SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND pharmacy_id=?', [sessionId, session.pharmacyId]);
    await conn.commit();
    res.json({ message: 'Draft counts saved.', savedCount: body.items.length });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

router.post('/:sessionId/submit', allowRoles(...countRoles), async (req, res, next) => {
  let conn;
  try {
    const sessionId = z.coerce.number().int().positive().safe().parse(req.params.sessionId);
    conn = await pool.getConnection(); await conn.beginTransaction();
    const session = await lockedSession(conn, sessionId); enforceSessionScope(req, session);
    if (session.status !== 'draft') throw new AppError(409, 'Only draft reconciliation sessions can be submitted.', 'INVALID_RECONCILIATION_STATE');
    if (Number(session.createdBy) !== Number(req.user.id)) throw new AppError(403, 'Only the staff member who started this draft can submit it.', 'RECONCILIATION_OWNER_REQUIRED');
    const [rows] = await conn.execute(
      `SELECT ri.batch_id AS batchId,b.batch_number AS batchNumber,ri.system_quantity AS systemQuantity,
              ri.physical_quantity AS physicalQuantity,ri.reason_code AS reasonCode,ri.reason_explanation AS reasonExplanation
       FROM inventory_reconciliation_items ri JOIN medicine_batches b ON b.id=ri.batch_id AND b.pharmacy_id=ri.pharmacy_id
       WHERE ri.session_id=? AND ri.pharmacy_id=? ORDER BY ri.batch_id FOR UPDATE`, [sessionId, session.pharmacyId],
    );
    assertCountComplete(rows);
    await conn.execute("UPDATE inventory_reconciliation_sessions SET status='submitted',submitted_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft'", [sessionId]);
    await writeAudit(conn, { pharmacyId: session.pharmacyId, userId: req.user.id, action: 'inventory.reconciliation.submitted', entityType: 'inventory_reconciliation', entityId: sessionId, details: { itemCount: rows.length } });
    await conn.commit();
    res.json({ id: sessionId, status: 'submitted', itemCount: rows.length });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

router.post('/:sessionId/approve', allowRoles(...reviewerRoles), async (req, res, next) => {
  let conn;
  try {
    const sessionId = z.coerce.number().int().positive().safe().parse(req.params.sessionId);
    conn = await pool.getConnection(); await conn.beginTransaction();
    const session = await lockedSession(conn, sessionId); enforceSessionScope(req, session);
    if (Number(session.createdBy) === Number(req.user.id)) throw new AppError(403, 'You cannot approve your own reconciliation.', 'SELF_APPROVAL_FORBIDDEN');
    if (session.status !== 'submitted') throw new AppError(409, 'Only submitted reconciliations can be approved.', 'INVALID_RECONCILIATION_STATE');
    const [items] = await conn.execute(
      `SELECT ri.batch_id AS batchId,ri.system_quantity AS systemQuantity,ri.physical_quantity AS physicalQuantity,
              ri.system_updated_at AS systemUpdatedAt,ri.system_history_id AS systemHistoryId,
              ri.reason_code AS reasonCode,ri.reason_explanation AS reasonExplanation,
              i.quantity_on_hand AS currentQuantity,i.updated_at AS currentUpdatedAt,
              (SELECT MAX(h.id) FROM stock_history h WHERE h.pharmacy_id=i.pharmacy_id AND h.batch_id=i.batch_id) AS currentHistoryId
       FROM inventory_reconciliation_items ri JOIN inventory i ON i.pharmacy_id=ri.pharmacy_id AND i.batch_id=ri.batch_id
       WHERE ri.session_id=? AND ri.pharmacy_id=? ORDER BY i.id FOR UPDATE`, [sessionId, session.pharmacyId],
    );
    const stale = items.length === 0 || items.some((item) => (
      Number(item.currentQuantity) !== Number(item.systemQuantity)
      || Number(item.currentHistoryId || 0) !== Number(item.systemHistoryId || 0)
      || new Date(item.currentUpdatedAt).getTime() !== new Date(item.systemUpdatedAt).getTime()
    ));
    if (stale) {
      const note = 'Stock changed after the count. Start a new reconciliation and recount.';
      await conn.execute("UPDATE inventory_reconciliation_sessions SET status='stale',review_note=? WHERE id=? AND status='submitted'", [note, sessionId]);
      await writeAudit(conn, { pharmacyId: session.pharmacyId, userId: req.user.id, action: 'inventory.reconciliation.stale', entityType: 'inventory_reconciliation', entityId: sessionId });
      await conn.commit();
      return res.status(409).json({ error: { code: 'STALE_RECONCILIATION', message: note } });
    }
    for (const item of items) {
      const discrepancy = calculateDiscrepancy(item.physicalQuantity, item.systemQuantity);
      if (discrepancy === 0) continue;
      const [updated] = await conn.execute(
        `UPDATE inventory SET quantity_on_hand=? WHERE pharmacy_id=? AND batch_id=? AND quantity_on_hand=?`,
        [item.physicalQuantity, session.pharmacyId, item.batchId, item.systemQuantity],
      );
      if (updated.affectedRows !== 1) throw new AppError(409, 'Stock changed during approval. The adjustment was not applied.', 'STALE_RECONCILIATION');
      const reason = `${item.reasonCode}: ${item.reasonExplanation || 'Physical stock count'}`.slice(0, 255);
      let quantityAfter = Number(item.systemQuantity);
      for (const historyDelta of splitHistoryDeltas(discrepancy)) {
        quantityAfter += historyDelta;
        await conn.execute(
          `INSERT INTO stock_history (pharmacy_id,batch_id,user_id,movement_type,quantity_delta,quantity_after,reference_type,reference_id,reason)
           VALUES (?,?,?,'adjustment',?,?,'inventory_reconciliation',?,?)`,
          [session.pharmacyId, item.batchId, req.user.id, historyDelta, quantityAfter, sessionId, reason],
        );
      }
    }
    await conn.execute(
      `UPDATE inventory_reconciliation_sessions SET status='approved',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_note=NULL
       WHERE id=? AND status='submitted'`, [req.user.id, sessionId],
    );
    await writeAudit(conn, { pharmacyId: session.pharmacyId, userId: req.user.id, action: 'inventory.reconciliation.approved', entityType: 'inventory_reconciliation', entityId: sessionId, details: { adjustedItems: items.filter((item) => Number(item.physicalQuantity) !== Number(item.systemQuantity)).length } });
    await conn.commit();
    res.json({ id: sessionId, status: 'approved', adjustedItems: items.filter((item) => Number(item.physicalQuantity) !== Number(item.systemQuantity)).length });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

router.post('/:sessionId/reject', allowRoles(...reviewerRoles), async (req, res, next) => {
  let conn;
  try {
    const sessionId = z.coerce.number().int().positive().safe().parse(req.params.sessionId);
    const body = z.object({ reason: z.string().trim().min(3).max(1000) }).parse(req.body);
    conn = await pool.getConnection(); await conn.beginTransaction();
    const session = await lockedSession(conn, sessionId); enforceSessionScope(req, session);
    if (session.status !== 'submitted') throw new AppError(409, 'Only submitted reconciliations can be rejected.', 'INVALID_RECONCILIATION_STATE');
    await conn.execute(
      `UPDATE inventory_reconciliation_sessions SET status='rejected',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_note=?
       WHERE id=? AND status='submitted'`, [req.user.id, body.reason, sessionId],
    );
    await writeAudit(conn, { pharmacyId: session.pharmacyId, userId: req.user.id, action: 'inventory.reconciliation.rejected', entityType: 'inventory_reconciliation', entityId: sessionId, details: { reason: body.reason } });
    await conn.commit();
    res.json({ id: sessionId, status: 'rejected' });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

module.exports = router;
