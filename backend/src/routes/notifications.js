const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { authenticate, pharmacyScope } = require('../middleware/auth');
const { AppError } = require('../lib/errors');
const { formatStorageNotification } = require('../lib/storageNotification');

const router = express.Router();
router.use(authenticate);

function scopeWhere(pharmacyId, column) {
  return pharmacyId ? { sql: ` AND ${column}=?`, params: [pharmacyId] } : { sql: '', params: [] };
}

async function upsertEvents(conn, events) {
  const batchSize = 200;
  for (let start = 0; start < events.length; start += batchSize) {
    const batch = events.slice(start, start + batchSize);
    const rowSql = '(?,?,?,?,?,?,?,?)';
    const params = batch.flatMap((event) => [
      event.pharmacyId, event.type, event.eventKey.slice(0, 190), event.title.slice(0, 180), event.message.slice(0, 500), event.severity, event.entityType, event.entityId,
    ]);
    await conn.execute(
      `INSERT INTO notifications (pharmacy_id,notification_type,event_key,title,message,severity,entity_type,entity_id)
       VALUES ${batch.map(() => rowSql).join(',')}
       ON DUPLICATE KEY UPDATE
         is_read=IF(resolved_at IS NOT NULL,FALSE,is_read),
         read_at=IF(resolved_at IS NOT NULL,NULL,read_at),
         title=VALUES(title),message=VALUES(message),severity=VALUES(severity),resolved_at=NULL,updated_at=CURRENT_TIMESTAMP`,
      params,
    );
  }
}

async function refreshNotifications(conn, pharmacyId) {
  const activeStock = scopeWhere(pharmacyId, 'i.pharmacy_id');
  const activeTransfers = scopeWhere(pharmacyId, 'target.id');
  const activeStorage = scopeWhere(pharmacyId, 'sl.pharmacy_id');

  const [expiryRows] = await conn.execute(
    `SELECT i.pharmacy_id AS pharmacyId,b.id AS entityId,
            CONCAT('expiry:',i.pharmacy_id,':',b.id) AS eventKey,
            CONCAT(IF(b.expiry_date<CURDATE(),'Expired medicine: ','Medicine expiring soon: '),m.name) AS title,
            CONCAT('Batch ',b.batch_number,' expires ',DATE_FORMAT(b.expiry_date,'%Y-%m-%d'),'; ',i.quantity_on_hand,' units remain.') AS message,
            CASE WHEN b.expiry_date<CURDATE() THEN 'critical' WHEN b.expiry_date<=DATE_ADD(CURDATE(),INTERVAL 7 DAY) THEN 'high' ELSE 'medium' END AS severity
     FROM inventory i JOIN medicine_batches b ON b.id=i.batch_id AND b.pharmacy_id=i.pharmacy_id
     JOIN medicines m ON m.id=b.medicine_id
     WHERE i.quantity_on_hand>0 AND b.expiry_date<=DATE_ADD(CURDATE(),INTERVAL 30 DAY)${activeStock.sql}
     ORDER BY b.expiry_date,b.id`, activeStock.params,
  );
  const [lowStockRows] = await conn.execute(
    `SELECT i.pharmacy_id AS pharmacyId,b.id AS entityId,
            CONCAT('low_stock:',i.pharmacy_id,':',b.id) AS eventKey,
            CONCAT('Low stock: ',m.name) AS title,
            CONCAT('Batch ',b.batch_number,' has ',i.quantity_on_hand,' units; reorder level is ',i.reorder_level,'.') AS message,
            IF(i.quantity_on_hand=0,'critical','high') AS severity
     FROM inventory i JOIN medicine_batches b ON b.id=i.batch_id AND b.pharmacy_id=i.pharmacy_id
     JOIN medicines m ON m.id=b.medicine_id
     WHERE i.quantity_on_hand<=i.reorder_level${activeStock.sql}
     ORDER BY i.quantity_on_hand,i.pharmacy_id,b.id`, activeStock.params,
  );
  const [transferRows] = await conn.execute(
    `SELECT target.id AS pharmacyId,t.id AS entityId,
            CONCAT('transfer:',t.id,':',t.status,':',target.id) AS eventKey,
            CASE t.status WHEN 'requested' THEN 'Stock transfer requested' WHEN 'approved' THEN 'Stock transfer approved'
              WHEN 'in_transit' THEN 'Stock transfer in transit' WHEN 'received' THEN 'Stock transfer received'
              WHEN 'rejected' THEN 'Stock transfer rejected' ELSE 'Stock transfer cancelled' END AS title,
            CONCAT(m.name,' · batch ',b.batch_number,' · ',t.quantity,' units · ',sp.name,' → ',dp.name) AS message,
            CASE WHEN t.status IN ('requested','rejected') THEN 'high' ELSE 'medium' END AS severity
     FROM stock_transfers t
     JOIN pharmacies sp ON sp.id=t.source_pharmacy_id JOIN pharmacies dp ON dp.id=t.destination_pharmacy_id
     JOIN medicine_batches b ON b.id=t.batch_id AND b.pharmacy_id=t.source_pharmacy_id JOIN medicines m ON m.id=b.medicine_id
     JOIN pharmacies target ON target.id=CASE WHEN t.status IN ('approved','received','rejected') THEN t.source_pharmacy_id ELSE t.destination_pharmacy_id END
     WHERE t.status IN ('requested','approved','in_transit','received','rejected','cancelled')
       AND NOT EXISTS (SELECT 1 FROM notifications existing WHERE existing.event_key=CONCAT('transfer:',t.id,':',t.status,':',target.id))${activeTransfers.sql}
     ORDER BY t.updated_at DESC,t.id DESC LIMIT 1000`, activeTransfers.params,
  );
  const [storageRows] = await conn.execute(
    `SELECT sl.pharmacy_id AS pharmacyId,sl.id AS entityId,sl.temperature_c AS temperatureC,
            sl.humidity_percent AS humidityPercent,sl.is_within_range AS isWithinRange,
            CONCAT('storage:',sl.pharmacy_id,':',sl.id) AS eventKey,
            CONCAT('Storage condition alert: ',p.name) AS title,
            sc.condition_status AS conditionStatus,
            'high' AS severity
     FROM storage_logs sl JOIN pharmacies p ON p.id=sl.pharmacy_id
     LEFT JOIN storage_condition_details sc ON sc.storage_log_id=sl.id
     WHERE (sl.is_within_range=FALSE OR (sc.condition_status IS NOT NULL AND sc.condition_status<>'normal'))
     ORDER BY sl.recorded_at DESC,sl.id DESC LIMIT 1000`, activeStorage.params,
  );

  const events = [
    ...expiryRows.map((row) => ({ ...row, type: 'medicine_expiry', entityType: 'medicine_batch' })),
    ...lowStockRows.map((row) => ({ ...row, type: 'low_stock', entityType: 'medicine_batch' })),
    ...transferRows.map((row) => ({ ...row, type: 'stock_transfer', entityType: 'stock_transfer' })),
    ...storageRows.map((row) => ({ ...row, ...formatStorageNotification(row), type: 'storage_violation', entityType: 'storage_log' })),
  ];
  await upsertEvents(conn, events);

  const expiryScope = scopeWhere(pharmacyId, 'n.pharmacy_id');
  await conn.execute(
    `UPDATE notifications n LEFT JOIN inventory i ON i.pharmacy_id=n.pharmacy_id AND i.batch_id=n.entity_id
       LEFT JOIN medicine_batches b ON b.id=i.batch_id AND b.pharmacy_id=i.pharmacy_id
     SET n.resolved_at=CURRENT_TIMESTAMP,n.updated_at=CURRENT_TIMESTAMP
     WHERE n.notification_type='medicine_expiry' AND n.resolved_at IS NULL
       AND (i.id IS NULL OR i.quantity_on_hand<=0 OR b.expiry_date>DATE_ADD(CURDATE(),INTERVAL 30 DAY))${expiryScope.sql}`,
    expiryScope.params,
  );
  await conn.execute(
    `UPDATE notifications n LEFT JOIN inventory i ON i.pharmacy_id=n.pharmacy_id AND i.batch_id=n.entity_id
     SET n.resolved_at=CURRENT_TIMESTAMP,n.updated_at=CURRENT_TIMESTAMP
     WHERE n.notification_type='low_stock' AND n.resolved_at IS NULL
       AND (i.id IS NULL OR i.quantity_on_hand>i.reorder_level)${expiryScope.sql}`,
    expiryScope.params,
  );
  await conn.execute(
    `UPDATE notifications n LEFT JOIN stock_transfers t ON t.id=n.entity_id
     SET n.resolved_at=CURRENT_TIMESTAMP,n.updated_at=CURRENT_TIMESTAMP
     WHERE n.notification_type='stock_transfer' AND n.resolved_at IS NULL
       AND (t.id IS NULL OR n.event_key<>CONCAT('transfer:',t.id,':',t.status,':',
         CASE WHEN t.status IN ('approved','received','rejected') THEN t.source_pharmacy_id ELSE t.destination_pharmacy_id END))${expiryScope.sql}`,
    expiryScope.params,
  );
}

function requestedPharmacy(req) {
  return pharmacyScope(req);
}

router.post('/refresh', async (req, res, next) => {
  let conn;
  try {
    const pharmacyId = requestedPharmacy(req);
    conn = await pool.getConnection(); await conn.beginTransaction();
    await refreshNotifications(conn, pharmacyId);
    const where = pharmacyId ? 'WHERE pharmacy_id=? AND resolved_at IS NULL AND is_read=FALSE' : 'WHERE resolved_at IS NULL AND is_read=FALSE';
    const [rows] = await conn.execute(`SELECT COUNT(*) AS count FROM notifications ${where}`, pharmacyId ? [pharmacyId] : []);
    await conn.commit();
    res.json({ count: Number(rows[0]?.count || 0) });
  } catch (error) {
    if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } }
    next(error);
  } finally { conn?.release(); }
});

router.get('/unread-count', async (req, res, next) => {
  try {
    const pharmacyId = requestedPharmacy(req);
    const where = pharmacyId ? 'WHERE pharmacy_id=? AND resolved_at IS NULL AND is_read=FALSE' : 'WHERE resolved_at IS NULL AND is_read=FALSE';
    const [rows] = await pool.execute(`SELECT COUNT(*) AS count FROM notifications ${where}`, pharmacyId ? [pharmacyId] : []);
    res.json({ count: Number(rows[0]?.count || 0) });
  } catch (error) { next(error); }
});

router.get('/', async (req, res, next) => {
  try {
    const query = z.object({
      page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20),
      type: z.enum(['medicine_expiry', 'low_stock', 'stock_transfer', 'storage_violation']).optional(),
      severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      status: z.enum(['all', 'read', 'unread']).default('all'), includeResolved: z.enum(['true', 'false']).default('false'),
    }).parse(req.query);
    const pharmacyId = requestedPharmacy(req);
    const clauses = [];
    const params = [];
    if (pharmacyId) { clauses.push('pharmacy_id=?'); params.push(pharmacyId); }
    if (query.type) { clauses.push('notification_type=?'); params.push(query.type); }
    if (query.severity) { clauses.push('severity=?'); params.push(query.severity); }
    if (query.status === 'read') clauses.push('is_read=TRUE');
    if (query.status === 'unread') clauses.push('is_read=FALSE');
    if (query.includeResolved !== 'true') clauses.push('resolved_at IS NULL');
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.limit;
    const countWhere = pharmacyId ? 'WHERE pharmacy_id=? AND resolved_at IS NULL AND is_read=FALSE' : 'WHERE resolved_at IS NULL AND is_read=FALSE';
    const [totalResult, rowsResult, unreadResult] = await Promise.all([
      pool.execute(`SELECT COUNT(*) AS total FROM notifications ${where}`, params),
      pool.execute(
      `SELECT n.id,n.pharmacy_id AS pharmacyId,p.name AS pharmacy,n.notification_type AS type,n.title,n.message,n.severity,
              n.entity_type AS entityType,n.entity_id AS entityId,n.is_read AS isRead,n.read_at AS readAt,
              n.resolved_at AS resolvedAt,n.created_at AS createdAt
       FROM notifications n JOIN pharmacies p ON p.id=n.pharmacy_id ${where}
       ORDER BY n.is_read ASC,n.severity='critical' DESC,n.created_at DESC,n.id DESC LIMIT ? OFFSET ?`,
      [...params, query.limit, offset],
      ),
      pool.execute(`SELECT COUNT(*) AS count FROM notifications ${countWhere}`, pharmacyId ? [pharmacyId] : []),
    ]);
    const total = totalResult[0][0]?.total || 0;
    const rows = rowsResult[0];
    const unreadRows = unreadResult[0];
    res.json({ data: rows, pagination: { page: query.page, limit: query.limit, total: Number(total), pages: Math.ceil(Number(total) / query.limit) }, unreadCount: Number(unreadRows[0]?.count || 0) });
  } catch (error) { next(error); }
});

router.patch('/:notificationId/read', async (req, res, next) => {
  try {
    const notificationId = z.coerce.number().int().positive().safe().parse(req.params.notificationId);
    const pharmacyId = requestedPharmacy(req);
    const params = [notificationId];
    const scope = pharmacyId ? ' AND pharmacy_id=?' : '';
    if (pharmacyId) params.push(pharmacyId);
    const [result] = await pool.execute(
      `UPDATE notifications SET is_read=TRUE,read_at=COALESCE(read_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
       WHERE id=?${scope}`,
      params,
    );
    // MySQL may report zero affected rows when an already-read row is submitted again.
    if (!result.affectedRows) {
      const [existing] = await pool.execute(`SELECT id FROM notifications WHERE id=?${scope}`, params);
      if (!existing.length) throw new AppError(404, 'Notification was not found.', 'NOTIFICATION_NOT_FOUND');
    }
    res.json({ message: 'Notification marked as read.' });
  } catch (error) { next(error); }
});

router.post('/read-all', async (req, res, next) => {
  try {
    const pharmacyId = requestedPharmacy(req);
    const scope = pharmacyId ? ' AND pharmacy_id=?' : '';
    const params = pharmacyId ? [pharmacyId] : [];
    const [result] = await pool.execute(
      `UPDATE notifications SET is_read=TRUE,read_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE is_read=FALSE AND resolved_at IS NULL${scope}`,
      params,
    );
    res.json({ updated: result.affectedRows });
  } catch (error) { next(error); }
});

module.exports = router;
