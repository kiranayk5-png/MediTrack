const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const pool = require('../db');
const { authenticate, allowRoles, pharmacyScope } = require('../middleware/auth');
const { AppError } = require('../lib/errors');
const { writeAudit } = require('../lib/audit');

const router = express.Router();
router.use(authenticate);
const allowedCreateRoles = ['platform_admin', 'pharmacy_manager', 'pharmacist', 'inventory_clerk'];
const idSchema = z.number().int().positive().safe();

async function roleRecord(roleName) {
  const [roles] = await pool.execute('SELECT id,name FROM roles WHERE name=?', [roleName]);
  if (!roles.length || !allowedCreateRoles.includes(roles[0].name)) throw new AppError(400, 'Choose a valid MediTrack role.', 'INVALID_ROLE');
  return roles[0];
}

async function activePharmacy(pharmacyId) {
  if (!pharmacyId) throw new AppError(400, 'A pharmacy must be assigned to this role.', 'PHARMACY_REQUIRED');
  const [rows] = await pool.execute('SELECT id FROM pharmacies WHERE id=? AND is_active=TRUE', [pharmacyId]);
  if (!rows.length) throw new AppError(400, 'Choose an active pharmacy.', 'INVALID_PHARMACY');
}

router.get('/roles', allowRoles('platform_admin', 'pharmacy_manager'), async (_req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT id,name,description FROM roles ORDER BY id');
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/', allowRoles('platform_admin', 'pharmacy_manager'), async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const clauses = [];
    const params = [];
    if (pharmacyId) { clauses.push('u.pharmacy_id=?'); params.push(pharmacyId); }
    const search = String(req.query.search || '').trim().slice(0, 100);
    if (search) { clauses.push('(u.full_name LIKE ? OR u.email LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT u.id,u.pharmacy_id AS pharmacyId,p.name AS pharmacy,u.role_id AS roleId,r.name AS role,
              u.full_name AS fullName,u.email,u.phone,u.is_active AS isActive,u.last_login_at AS lastLoginAt,u.created_at AS createdAt
       FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN pharmacies p ON p.id=u.pharmacy_id
       ${where} ORDER BY u.full_name LIMIT 200`, params,
    );
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.post('/', allowRoles('platform_admin', 'pharmacy_manager'), async (req, res, next) => {
  let conn;
  try {
    const body = z.object({
      fullName: z.string().trim().min(2).max(150), email: z.string().trim().email().max(254),
      phone: z.string().trim().max(30).nullable().optional(), role: z.enum(allowedCreateRoles),
      pharmacyId: idSchema.nullable().optional(), password: z.string().min(12).max(200),
    }).parse(req.body);
    if (req.user.role === 'pharmacy_manager' && body.role === 'platform_admin') throw new AppError(403, 'Pharmacy managers cannot create platform administrators.', 'ROLE_FORBIDDEN');
    const pharmacyId = req.user.role === 'platform_admin' ? (body.role === 'platform_admin' ? null : body.pharmacyId) : pharmacyScope(req);
    if (pharmacyId) await activePharmacy(pharmacyId);
    if (body.role !== 'platform_admin' && !pharmacyId) throw new AppError(400, 'A pharmacy must be assigned to this role.', 'PHARMACY_REQUIRED');
    if (req.user.role === 'pharmacy_manager' && body.pharmacyId && Number(body.pharmacyId) !== Number(pharmacyId)) throw new AppError(403, 'You can only add staff to your pharmacy.', 'PHARMACY_FORBIDDEN');
    const role = await roleRecord(body.role);
    const passwordHash = await bcrypt.hash(body.password, 12);
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [result] = await conn.execute(
      'INSERT INTO users (pharmacy_id,role_id,full_name,email,password_hash,phone,is_active) VALUES (?,?,?,?,?,?,TRUE)',
      [pharmacyId, role.id, body.fullName, body.email.toLowerCase(), passwordHash, body.phone ?? null],
    );
    await writeAudit(conn, { pharmacyId, userId: req.user.id, action: 'staff.created', entityType: 'user', entityId: result.insertId, details: { role: role.name } });
    await conn.commit(); res.status(201).json({ id: result.insertId });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

router.put('/:userId', allowRoles('platform_admin', 'pharmacy_manager'), async (req, res, next) => {
  let conn;
  try {
    const userId = z.coerce.number().int().positive().safe().parse(req.params.userId);
    const body = z.object({
      fullName: z.string().trim().min(2).max(150), email: z.string().trim().email().max(254),
      phone: z.string().trim().max(30).nullable().optional(), role: z.enum(allowedCreateRoles),
      pharmacyId: idSchema.nullable().optional(), isActive: z.boolean(), password: z.string().min(12).max(200).optional(),
    }).parse(req.body);
    if (req.user.role === 'pharmacy_manager' && body.role === 'platform_admin') throw new AppError(403, 'Pharmacy managers cannot assign the platform administrator role.', 'ROLE_FORBIDDEN');
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [targets] = await conn.execute('SELECT id,pharmacy_id AS pharmacyId,role_id AS roleId FROM users WHERE id=? FOR UPDATE', [userId]);
    if (!targets.length) throw new AppError(404, 'Staff account was not found.', 'STAFF_NOT_FOUND');
    const target = targets[0];
    const currentScope = req.user.role === 'platform_admin' ? null : pharmacyScope(req);
    if (currentScope && Number(target.pharmacyId) !== Number(currentScope)) throw new AppError(404, 'Staff account was not found in this pharmacy.', 'STAFF_NOT_FOUND');
    if (currentScope && body.pharmacyId != null && Number(body.pharmacyId) !== Number(currentScope)) throw new AppError(403, 'You can only assign staff within your own pharmacy.', 'PHARMACY_FORBIDDEN');
    if (req.user.id === userId && (!body.isActive || body.role !== req.user.role)) throw new AppError(400, 'You cannot deactivate yourself or change your own role.', 'SELF_ADMIN_CHANGE');
    const pharmacyId = req.user.role === 'platform_admin'
      ? (body.role === 'platform_admin' ? null : (body.pharmacyId === undefined ? target.pharmacyId : body.pharmacyId))
      : currentScope;
    if (pharmacyId) await activePharmacy(pharmacyId);
    if (body.role !== 'platform_admin' && !pharmacyId) throw new AppError(400, 'A pharmacy must be assigned to this role.', 'PHARMACY_REQUIRED');
    const role = await roleRecord(body.role);
    const values = [pharmacyId, role.id, body.fullName, body.email.toLowerCase(), body.phone ?? null, body.isActive];
    let sql = 'UPDATE users SET pharmacy_id=?,role_id=?,full_name=?,email=?,phone=?,is_active=?';
    if (body.password) { sql += ',password_hash=?'; values.push(await bcrypt.hash(body.password, 12)); }
    sql += ' WHERE id=?'; values.push(userId);
    await conn.execute(sql, values);
    await writeAudit(conn, { pharmacyId, userId: req.user.id, action: 'staff.updated', entityType: 'user', entityId: userId, details: { role: role.name, isActive: body.isActive, passwordReset: Boolean(body.password) } });
    await conn.commit(); res.json({ message: 'Staff account updated.' });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

module.exports = router;
