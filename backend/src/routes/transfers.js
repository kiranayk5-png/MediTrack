const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { authenticate, allowRoles, pharmacyScope } = require('../middleware/auth');
const { AppError } = require('../lib/errors');
const { mysqlBoolean } = require('../lib/mysqlBoolean');
const { writeAudit } = require('../lib/audit');

const router = express.Router();
router.use(authenticate);
const idSchema = z.number().int().positive().safe();

function assertPharmacy(req, pharmacyId) {
  if (req.user.role !== 'platform_admin' && Number(req.user.pharmacyId) !== Number(pharmacyId)) {
    throw new AppError(403, 'This transfer is outside your pharmacy.', 'PHARMACY_FORBIDDEN');
  }
}

async function lockedTransfer(conn, transferId) {
  const [rows] = await conn.execute(
    `SELECT id,source_pharmacy_id AS sourcePharmacyId,destination_pharmacy_id AS destinationPharmacyId,
            batch_id AS batchId,requested_by AS requestedBy,quantity,status
     FROM stock_transfers WHERE id=? FOR UPDATE`, [transferId],
  );
  if (!rows.length) throw new AppError(404, 'Transfer was not found.', 'TRANSFER_NOT_FOUND');
  return rows[0];
}

async function ensurePharmaciesActive(conn, sourceId, destinationId) {
  const [rows] = await conn.execute('SELECT id FROM pharmacies WHERE id IN (?,?) AND is_active=TRUE FOR UPDATE', [sourceId, destinationId]);
  if (rows.length !== 2) throw new AppError(400, 'Both pharmacies must exist and be active.', 'INVALID_PHARMACY');
}

router.get('/', async (req, res, next) => {
  try {
    const requestedScope = pharmacyScope(req);
    const clauses = [];
    const params = [];
    if (requestedScope) {
      clauses.push('(t.source_pharmacy_id=? OR t.destination_pharmacy_id=?)');
      params.push(requestedScope, requestedScope);
    } else if (req.user.role !== 'platform_admin') {
      throw new AppError(403, 'A pharmacy assignment is required.', 'PHARMACY_REQUIRED');
    }
    if (req.query.status) {
      const status = z.enum(['requested', 'approved', 'in_transit', 'received', 'rejected', 'cancelled']).parse(req.query.status);
      clauses.push('t.status=?'); params.push(status);
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT t.id,t.source_pharmacy_id AS sourcePharmacyId,sp.name AS sourcePharmacy,
              t.destination_pharmacy_id AS destinationPharmacyId,dp.name AS destinationPharmacy,
              t.batch_id AS batchId,b.batch_number AS batchNumber,m.id AS medicineId,m.name AS medicineName,
              b.expiry_date AS expiryDate,t.quantity,t.status,t.requested_by AS requestedBy,
              t.approved_by AS approvedBy,t.received_by AS receivedBy,t.requested_at AS requestedAt,
              t.shipped_at AS shippedAt,t.received_at AS receivedAt,t.notes
       FROM stock_transfers t JOIN pharmacies sp ON sp.id=t.source_pharmacy_id
       JOIN pharmacies dp ON dp.id=t.destination_pharmacy_id
       JOIN medicine_batches b ON b.id=t.batch_id AND b.pharmacy_id=t.source_pharmacy_id
       JOIN medicines m ON m.id=b.medicine_id ${where}
       ORDER BY t.requested_at DESC,t.id DESC LIMIT ?`, [...params, limit],
    );
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.post('/', allowRoles('platform_admin', 'pharmacy_manager', 'inventory_clerk'), async (req, res, next) => {
  let conn;
  try {
    const body = z.object({
      sourcePharmacyId: idSchema.optional(), destinationPharmacyId: idSchema,
      batchId: idSchema, quantity: z.number().int().positive().max(100000), notes: z.string().trim().max(1000).nullable().optional(),
    }).parse(req.body);
    conn = await pool.getConnection();
    const sourceId = req.user.role === 'platform_admin'
      ? idSchema.parse(body.sourcePharmacyId)
      : pharmacyScope(req);
    const destinationId = body.destinationPharmacyId;
    if (sourceId === destinationId) throw new AppError(400, 'Source and destination pharmacies must be different.', 'TRANSFER_SAME_PHARMACY');
    assertPharmacy(req, sourceId);
    await conn.beginTransaction();
    await ensurePharmaciesActive(conn, sourceId, destinationId);
    const [stock] = await conn.execute(
      `SELECT i.quantity_on_hand AS quantityOnHand,(b.expiry_date < CURRENT_DATE()) AS isExpired,
              EXISTS(SELECT 1 FROM recall_records rr WHERE rr.pharmacy_id=b.pharmacy_id AND rr.medicine_id=b.medicine_id
                AND rr.status <> 'closed' AND (rr.batch_id IS NULL OR rr.batch_id=b.id)) AS recalled
       FROM inventory i JOIN medicine_batches b ON b.id=i.batch_id AND b.pharmacy_id=i.pharmacy_id
       WHERE i.pharmacy_id=? AND i.batch_id=? FOR UPDATE`, [sourceId, body.batchId],
    );
    if (!stock.length || Number(stock[0].quantityOnHand) < body.quantity) throw new AppError(409, 'The source pharmacy does not have enough stock for this request.', 'INSUFFICIENT_STOCK');
    if (Number(stock[0].isExpired) !== 0) throw new AppError(409, 'Expired or unverifiable batches cannot be transferred.', 'BATCH_EXPIRED');
    if (mysqlBoolean(stock[0].recalled) !== false) throw new AppError(409, 'Recalled or unverified batch status cannot be transferred.', 'BATCH_RECALLED');
    const [result] = await conn.execute(
      `INSERT INTO stock_transfers (source_pharmacy_id,destination_pharmacy_id,batch_id,requested_by,quantity,status,notes)
       VALUES (?,?,?,?,?,'requested',?)`, [sourceId, destinationId, body.batchId, req.user.id, body.quantity, body.notes ?? null],
    );
    await writeAudit(conn, { pharmacyId: sourceId, userId: req.user.id, action: 'transfer.requested', entityType: 'stock_transfer', entityId: result.insertId, details: { destinationPharmacyId: destinationId, batchId: body.batchId, quantity: body.quantity } });
    await conn.commit();
    res.status(201).json({ id: result.insertId, status: 'requested' });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

router.post('/:transferId/approve', allowRoles('platform_admin', 'pharmacy_manager'), async (req, res, next) => {
  let conn;
  try {
    const transferId = z.coerce.number().int().positive().safe().parse(req.params.transferId);
    conn = await pool.getConnection(); await conn.beginTransaction();
    const transfer = await lockedTransfer(conn, transferId); assertPharmacy(req, transfer.sourcePharmacyId);
    if (transfer.status !== 'requested') throw new AppError(409, 'Only requested transfers can be approved.', 'INVALID_TRANSFER_STATE');
    await conn.execute("UPDATE stock_transfers SET status='approved',approved_by=? WHERE id=?", [req.user.id, transferId]);
    await writeAudit(conn, { pharmacyId: transfer.sourcePharmacyId, userId: req.user.id, action: 'transfer.approved', entityType: 'stock_transfer', entityId: transferId });
    await conn.commit(); res.json({ id: transferId, status: 'approved' });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

router.post('/:transferId/ship', allowRoles('platform_admin', 'pharmacy_manager'), async (req, res, next) => {
  let conn;
  try {
    const transferId = z.coerce.number().int().positive().safe().parse(req.params.transferId);
    conn = await pool.getConnection(); await conn.beginTransaction();
    const transfer = await lockedTransfer(conn, transferId); assertPharmacy(req, transfer.sourcePharmacyId);
    if (transfer.status !== 'approved') throw new AppError(409, 'Only approved transfers can be shipped.', 'INVALID_TRANSFER_STATE');
    const [stock] = await conn.execute(
      `SELECT i.quantity_on_hand AS quantityOnHand,(b.expiry_date < CURRENT_DATE()) AS isExpired,
              EXISTS(SELECT 1 FROM recall_records rr WHERE rr.pharmacy_id=b.pharmacy_id AND rr.medicine_id=b.medicine_id
                AND rr.status <> 'closed' AND (rr.batch_id IS NULL OR rr.batch_id=b.id)) AS recalled
       FROM inventory i JOIN medicine_batches b ON b.id=i.batch_id AND b.pharmacy_id=i.pharmacy_id
       WHERE i.pharmacy_id=? AND i.batch_id=? FOR UPDATE`, [transfer.sourcePharmacyId, transfer.batchId],
    );
    if (!stock.length || Number(stock[0].quantityOnHand) < Number(transfer.quantity)) throw new AppError(409, 'Available stock changed; this transfer cannot be shipped.', 'INSUFFICIENT_STOCK');
    if (Number(stock[0].isExpired) !== 0) throw new AppError(409, 'Expired or unverifiable batches cannot be shipped.', 'BATCH_EXPIRED');
    if (mysqlBoolean(stock[0].recalled) !== false) throw new AppError(409, 'Recalled or unverified batch status cannot be shipped.', 'BATCH_RECALLED');
    const after = Number(stock[0].quantityOnHand) - Number(transfer.quantity);
    await conn.execute('UPDATE inventory SET quantity_on_hand=? WHERE pharmacy_id=? AND batch_id=?', [after, transfer.sourcePharmacyId, transfer.batchId]);
    await conn.execute(
      `INSERT INTO stock_history (pharmacy_id,batch_id,user_id,transfer_id,movement_type,quantity_delta,quantity_after,reference_type,reference_id,reason)
       VALUES (?,?,?,?,'transfer_out',?,?, 'stock_transfer',?,?)`,
      [transfer.sourcePharmacyId, transfer.batchId, req.user.id, transferId, -Number(transfer.quantity), after, transferId, `Transfer ${transferId} shipped`],
    );
    await conn.execute("UPDATE stock_transfers SET status='in_transit',shipped_at=CURRENT_TIMESTAMP WHERE id=?", [transferId]);
    await writeAudit(conn, { pharmacyId: transfer.sourcePharmacyId, userId: req.user.id, action: 'transfer.shipped', entityType: 'stock_transfer', entityId: transferId, details: { quantity: transfer.quantity } });
    await conn.commit(); res.json({ id: transferId, status: 'in_transit', sourceQuantityOnHand: after });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

router.post('/:transferId/receive', allowRoles('platform_admin', 'pharmacy_manager'), async (req, res, next) => {
  let conn;
  try {
    const transferId = z.coerce.number().int().positive().safe().parse(req.params.transferId);
    conn = await pool.getConnection(); await conn.beginTransaction();
    const transfer = await lockedTransfer(conn, transferId); assertPharmacy(req, transfer.destinationPharmacyId);
    if (transfer.status !== 'in_transit') throw new AppError(409, 'Only in-transit transfers can be received.', 'INVALID_TRANSFER_STATE');
    const [[sourceBatch]] = await conn.execute(
      `SELECT id,medicine_id AS medicineId,batch_number AS batchNumber,manufacture_date AS manufactureDate,
              expiry_date AS expiryDate,purchase_price AS purchasePrice,selling_price AS sellingPrice,pharmacy_id AS pharmacyId
       FROM medicine_batches WHERE id=? AND pharmacy_id=? FOR UPDATE`, [transfer.batchId, transfer.sourcePharmacyId],
    );
    if (!sourceBatch) throw new AppError(409, 'The transferred source batch is unavailable.', 'TRANSFER_BATCH_MISSING');
    const [sourceRecalls] = await conn.execute(
      `SELECT EXISTS(SELECT 1 FROM recall_records rr WHERE rr.pharmacy_id=? AND rr.medicine_id=? AND rr.status <> 'closed'
        AND (rr.batch_id IS NULL OR rr.batch_id=?)) AS recalled`, [transfer.sourcePharmacyId, sourceBatch.medicineId, transfer.batchId],
    );
    if (mysqlBoolean(sourceRecalls[0]?.recalled) !== false) throw new AppError(409, 'A recall is active or could not be verified for this batch; contact the source pharmacy.', 'BATCH_RECALLED');
    const [destinationBatches] = await conn.execute(
      `SELECT id,manufacture_date AS manufactureDate,expiry_date AS expiryDate,purchase_price AS purchasePrice,selling_price AS sellingPrice
       FROM medicine_batches WHERE pharmacy_id=? AND medicine_id=? AND batch_number=? FOR UPDATE`,
      [transfer.destinationPharmacyId, sourceBatch.medicineId, sourceBatch.batchNumber],
    );
    let destinationBatchId;
    if (destinationBatches.length) {
      const existing = destinationBatches[0];
      if (String(existing.expiryDate).slice(0, 10) !== String(sourceBatch.expiryDate).slice(0, 10)
        || String(existing.manufactureDate).slice(0, 10) !== String(sourceBatch.manufactureDate).slice(0, 10)
        || Number(existing.purchasePrice) !== Number(sourceBatch.purchasePrice)
        || Number(existing.sellingPrice) !== Number(sourceBatch.sellingPrice)) {
        throw new AppError(409, 'A destination batch with this lot number has conflicting details.', 'TRANSFER_BATCH_CONFLICT');
      }
      destinationBatchId = existing.id;
    }
    const [destinationRecalls] = await conn.execute(
      `SELECT EXISTS(SELECT 1 FROM recall_records rr WHERE rr.pharmacy_id=? AND rr.medicine_id=? AND rr.status <> 'closed'
        AND (rr.batch_id IS NULL OR rr.batch_id=?)) AS recalled`,
      [transfer.destinationPharmacyId, sourceBatch.medicineId, destinationBatchId || 0],
    );
    if (mysqlBoolean(destinationRecalls[0]?.recalled) !== false) throw new AppError(409, 'A destination pharmacy recall is active or could not be verified for this medicine.', 'BATCH_RECALLED');
    if (!destinationBatchId) {
      const [created] = await conn.execute(
        `INSERT INTO medicine_batches (pharmacy_id,medicine_id,supplier_id,batch_number,manufacture_date,expiry_date,purchase_price,selling_price)
         VALUES (?,?,NULL,?,?,?, ?,?)`,
        [transfer.destinationPharmacyId, sourceBatch.medicineId, sourceBatch.batchNumber, sourceBatch.manufactureDate, sourceBatch.expiryDate, sourceBatch.purchasePrice, sourceBatch.sellingPrice],
      );
      destinationBatchId = created.insertId;
    }
    const [balances] = await conn.execute('SELECT quantity_on_hand AS quantityOnHand FROM inventory WHERE pharmacy_id=? AND batch_id=? FOR UPDATE', [transfer.destinationPharmacyId, destinationBatchId]);
    const after = (balances.length ? Number(balances[0].quantityOnHand) : 0) + Number(transfer.quantity);
    if (balances.length) await conn.execute('UPDATE inventory SET quantity_on_hand=? WHERE pharmacy_id=? AND batch_id=?', [after, transfer.destinationPharmacyId, destinationBatchId]);
    else await conn.execute('INSERT INTO inventory (pharmacy_id,batch_id,quantity_on_hand,reorder_level) VALUES (?,?,?,0)', [transfer.destinationPharmacyId, destinationBatchId, after]);
    await conn.execute(
      `INSERT INTO stock_history (pharmacy_id,batch_id,user_id,transfer_id,movement_type,quantity_delta,quantity_after,reference_type,reference_id,reason)
       VALUES (?,?,?,?,'transfer_in',?,?, 'stock_transfer',?,?)`,
      [transfer.destinationPharmacyId, destinationBatchId, req.user.id, transferId, Number(transfer.quantity), after, transferId, `Transfer ${transferId} received from batch ${sourceBatch.batchNumber}`],
    );
    await conn.execute("UPDATE stock_transfers SET status='received',received_by=?,received_at=CURRENT_TIMESTAMP WHERE id=?", [req.user.id, transferId]);
    await writeAudit(conn, { pharmacyId: transfer.destinationPharmacyId, userId: req.user.id, action: 'transfer.received', entityType: 'stock_transfer', entityId: transferId, details: { sourcePharmacyId: transfer.sourcePharmacyId, batchId: destinationBatchId, quantity: transfer.quantity } });
    await conn.commit(); res.json({ id: transferId, status: 'received', destinationBatchId, destinationQuantityOnHand: after });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

router.post('/:transferId/reject', allowRoles('platform_admin', 'pharmacy_manager'), async (req, res, next) => {
  let conn;
  try {
    const transferId = z.coerce.number().int().positive().safe().parse(req.params.transferId);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    conn = await pool.getConnection(); await conn.beginTransaction();
    const transfer = await lockedTransfer(conn, transferId); assertPharmacy(req, transfer.destinationPharmacyId);
    if (!['requested', 'approved'].includes(transfer.status)) throw new AppError(409, 'This transfer can no longer be rejected.', 'INVALID_TRANSFER_STATE');
    await conn.execute("UPDATE stock_transfers SET status='rejected',notes=CONCAT(COALESCE(notes,''),?) WHERE id=?", [`\nRejected: ${reason}`, transferId]);
    await writeAudit(conn, { pharmacyId: transfer.destinationPharmacyId, userId: req.user.id, action: 'transfer.rejected', entityType: 'stock_transfer', entityId: transferId, details: { reason } });
    await conn.commit(); res.json({ id: transferId, status: 'rejected' });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

router.post('/:transferId/cancel', allowRoles('platform_admin', 'pharmacy_manager', 'inventory_clerk'), async (req, res, next) => {
  let conn;
  try {
    const transferId = z.coerce.number().int().positive().safe().parse(req.params.transferId);
    conn = await pool.getConnection(); await conn.beginTransaction();
    const transfer = await lockedTransfer(conn, transferId); assertPharmacy(req, transfer.sourcePharmacyId);
    if (['requested', 'approved'].includes(transfer.status)) {
      await conn.execute("UPDATE stock_transfers SET status='cancelled' WHERE id=?", [transferId]);
    } else if (transfer.status === 'in_transit') {
      const [[balance]] = await conn.execute('SELECT quantity_on_hand AS quantityOnHand FROM inventory WHERE pharmacy_id=? AND batch_id=? FOR UPDATE', [transfer.sourcePharmacyId, transfer.batchId]);
      if (!balance) throw new AppError(409, 'The source inventory balance is missing; this transfer cannot be safely returned.', 'TRANSFER_BALANCE_MISSING');
      const after = Number(balance.quantityOnHand) + Number(transfer.quantity);
      await conn.execute('UPDATE inventory SET quantity_on_hand=? WHERE pharmacy_id=? AND batch_id=?', [after, transfer.sourcePharmacyId, transfer.batchId]);
      await conn.execute(
        `INSERT INTO stock_history (pharmacy_id,batch_id,user_id,transfer_id,movement_type,quantity_delta,quantity_after,reference_type,reference_id,reason)
         VALUES (?,?,?,?,'transfer_in',?,?, 'stock_transfer',?,?)`,
        [transfer.sourcePharmacyId, transfer.batchId, req.user.id, transferId, Number(transfer.quantity), after, transferId, `Transfer ${transferId} returned to source`],
      );
      await conn.execute("UPDATE stock_transfers SET status='cancelled' WHERE id=?", [transferId]);
    } else throw new AppError(409, 'This transfer can no longer be cancelled.', 'INVALID_TRANSFER_STATE');
    await writeAudit(conn, { pharmacyId: transfer.sourcePharmacyId, userId: req.user.id, action: 'transfer.cancelled', entityType: 'stock_transfer', entityId: transferId });
    await conn.commit(); res.json({ id: transferId, status: 'cancelled' });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

module.exports = router;
