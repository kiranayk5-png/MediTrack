const express = require('express');
const { authenticate, pharmacyScope } = require('../middleware/auth');
const pool = require('../db');

const router = express.Router();
router.use(authenticate);

router.get('/destinations', async (req, res, next) => {
  try {
    const sourcePharmacyId = req.user.role === 'platform_admin' ? null : pharmacyScope(req);
    if (!sourcePharmacyId && req.user.role !== 'platform_admin') {
      return res.status(403).json({ error: { code: 'PHARMACY_REQUIRED', message: 'A pharmacy assignment is required.' } });
    }
    const [rows] = await pool.execute(
      `SELECT p.id,p.name,p.city,p.state FROM pharmacies p
       WHERE p.is_active=TRUE${sourcePharmacyId ? ' AND p.id<>?' : ''} ORDER BY p.name LIMIT 200`,
      sourcePharmacyId ? [sourcePharmacyId] : [],
    );
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/', async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const search = String(req.query.search || '').trim().slice(0, 100);
    const clauses = [];
    const params = [];

    if (pharmacyId) {
      clauses.push('p.id = ?');
      params.push(pharmacyId);
    } else {
      clauses.push('p.is_active = TRUE');
    }
    if (search) {
      clauses.push('(p.name LIKE ? OR p.city LIKE ? OR p.state LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    const [rows] = await pool.execute(
      `SELECT p.id, p.name, p.city, p.state, p.is_active AS isActive
       FROM pharmacies p WHERE ${clauses.join(' AND ')} ORDER BY p.name LIMIT 100`,
      params,
    );
    res.json({ data: rows });
  } catch (error) { next(error); }
});

module.exports = router;
