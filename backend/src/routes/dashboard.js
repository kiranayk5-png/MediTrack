const express = require('express');
const pool = require('../db');
const { authenticate, pharmacyScope } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

function filterFor(pharmacyId, alias = 'pharmacy_id') {
  return pharmacyId ? { sql: ` AND ${alias} = ?`, args: [pharmacyId] } : { sql: '', args: [] };
}

router.get('/', async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const batchFilter = filterFor(pharmacyId, 'b.pharmacy_id');
    const invFilter = filterFor(pharmacyId, 'i.pharmacy_id');
    const salesFilter = filterFor(pharmacyId, 's.pharmacy_id');
    // Both audit_logs and users expose pharmacy_id, so this join must use the audit alias.
    const auditFilter = filterFor(pharmacyId, 'a.pharmacy_id');
    const [medicines] = await pool.execute(
      pharmacyId
        ? `SELECT COUNT(DISTINCT b.medicine_id) AS total FROM medicine_batches b
           JOIN inventory i ON i.batch_id=b.id AND i.pharmacy_id=b.pharmacy_id
           JOIN medicines m ON m.id=b.medicine_id
           WHERE b.pharmacy_id=? AND m.is_active=TRUE`
        : 'SELECT COUNT(*) AS total FROM medicines WHERE is_active = TRUE',
      pharmacyId ? [pharmacyId] : [],
    );
    const [stock] = await pool.execute(`SELECT COALESCE(SUM(CASE WHEN b.expiry_date >= CURDATE() AND NOT EXISTS (
        SELECT 1 FROM recall_records rr WHERE rr.pharmacy_id=b.pharmacy_id AND rr.medicine_id=b.medicine_id AND rr.status <> 'closed'
          AND (rr.batch_id IS NULL OR rr.batch_id=b.id)
      ) THEN i.quantity_on_hand ELSE 0 END), 0) AS units,
      COUNT(DISTINCT CASE WHEN i.quantity_on_hand <= i.reorder_level THEN i.batch_id END) AS lowStockBatches
      FROM inventory i JOIN medicine_batches b ON b.id=i.batch_id AND b.pharmacy_id=i.pharmacy_id WHERE 1=1${invFilter.sql}`, invFilter.args);
    const [expiry] = await pool.execute(`SELECT
      COUNT(DISTINCT CASE WHEN b.expiry_date >= CURDATE() AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND i.quantity_on_hand > 0 THEN b.id END) AS expiringBatches,
      COUNT(DISTINCT CASE WHEN b.expiry_date < CURDATE() AND i.quantity_on_hand > 0 THEN b.id END) AS expiredBatches
      FROM medicine_batches b JOIN inventory i ON i.batch_id=b.id AND i.pharmacy_id=b.pharmacy_id WHERE 1=1${batchFilter.sql}`, batchFilter.args);
    const [sales] = await pool.execute(`SELECT COALESCE(SUM(CASE WHEN s.status='completed' THEN s.total_amount ELSE 0 END), 0) AS todayRevenue,
      COUNT(CASE WHEN s.status='completed' THEN 1 END) AS todayTransactions
      FROM sales s WHERE DATE(s.sold_at)=CURDATE()${salesFilter.sql}`, salesFilter.args);
    const [recentActivity] = await pool.execute(`SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
      a.occurred_at AS occurredAt, u.full_name AS userName, a.details
      FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE 1=1${auditFilter.sql}
      ORDER BY a.occurred_at DESC LIMIT 8`, auditFilter.args);
    const [salesTrend] = await pool.execute(`SELECT DATE(s.sold_at) AS date, SUM(s.total_amount) AS revenue, COUNT(*) AS transactions
      FROM sales s WHERE s.status='completed' AND s.sold_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)${salesFilter.sql}
      GROUP BY DATE(s.sold_at) ORDER BY date`, salesFilter.args);
    const [stockByMedicine] = await pool.execute(`SELECT m.name, SUM(i.quantity_on_hand) AS quantity
      FROM inventory i JOIN medicine_batches b ON b.id=i.batch_id AND b.pharmacy_id=i.pharmacy_id
      JOIN medicines m ON m.id=b.medicine_id WHERE b.expiry_date >= CURDATE()
      AND NOT EXISTS (SELECT 1 FROM recall_records rr WHERE rr.pharmacy_id=b.pharmacy_id AND rr.medicine_id=b.medicine_id AND rr.status <> 'closed'
        AND (rr.batch_id IS NULL OR rr.batch_id=b.id))${invFilter.sql}
      GROUP BY m.id, m.name ORDER BY quantity DESC LIMIT 6`, invFilter.args);
    res.json({
      pharmacyId,
      metrics: {
        totalMedicines: Number(medicines[0].total), availableUnits: Number(stock[0].units),
        lowStockBatches: Number(stock[0].lowStockBatches), expiringBatches: Number(expiry[0].expiringBatches),
        expiredBatches: Number(expiry[0].expiredBatches), todayRevenue: Number(sales[0].todayRevenue), todayTransactions: Number(sales[0].todayTransactions),
      },
      salesTrend,
      stockByMedicine,
      recentActivity: recentActivity.map((row) => ({ ...row, details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details })),
    });
  } catch (error) { next(error); }
});

module.exports = router;
