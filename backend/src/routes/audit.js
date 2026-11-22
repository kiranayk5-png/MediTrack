const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { authenticate, allowRoles, pharmacyScope } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, allowRoles('platform_admin', 'pharmacy_manager'));

router.get('/', async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const clauses = [];
    const params = [];
    if (pharmacyId) { clauses.push('a.pharmacy_id=?'); params.push(pharmacyId); }
    if (req.query.action) { clauses.push('a.action=?'); params.push(z.string().trim().min(1).max(100).parse(req.query.action)); }
    if (req.query.entityType) { clauses.push('a.entity_type=?'); params.push(z.string().trim().min(1).max(100).parse(req.query.entityType)); }
    if (req.query.from) { clauses.push('a.occurred_at>=?'); params.push(z.string().date().parse(req.query.from)); }
    if (req.query.to) { clauses.push('a.occurred_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(z.string().date().parse(req.query.to)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM audit_logs a ${where}`, params);
    const [rows] = await pool.execute(
      `SELECT a.id,a.pharmacy_id AS pharmacyId,p.name AS pharmacy,a.user_id AS userId,u.full_name AS userName,
              a.action,a.entity_type AS entityType,a.entity_id AS entityId,a.details,a.occurred_at AS occurredAt
       FROM audit_logs a LEFT JOIN pharmacies p ON p.id=a.pharmacy_id LEFT JOIN users u ON u.id=a.user_id
       ${where} ORDER BY a.occurred_at DESC,a.id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit],
    );
    res.json({ data: rows.map((row) => ({ ...row, details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details })), pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } });
  } catch (error) { next(error); }
});

module.exports = router;
