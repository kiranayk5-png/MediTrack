const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const pool = require('../db');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../lib/errors');
const validate = require('../middleware/validate');
const { createSession, revokeSession } = require('../lib/sessionStore');
const crypto = require('node:crypto');

const router = express.Router();
const loginSchema = z.object({ body: z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) }), query: z.any(), params: z.any() });

function cookieOptions() {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite, path: '/', maxAge: 8 * 60 * 60 * 1000 };
}

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.pharmacy_id AS pharmacyId, u.full_name AS fullName, u.email, u.password_hash AS passwordHash,
              u.is_active AS isActive, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ? LIMIT 1`,
      [req.validated.body.email.toLowerCase()],
    );
    const user = rows[0];
    if (!user || !user.isActive || !(await bcrypt.compare(req.validated.body.password, user.passwordHash))) {
      throw new AppError(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS');
    }
    const tokenId = crypto.randomBytes(32).toString('base64url');
    const token = jwt.sign(
      {},
      config.jwtSecret,
      { subject: String(user.id), jwtid: tokenId, expiresIn: config.jwtExpiresIn, algorithm: 'HS256' },
    );
    const claims = jwt.decode(token);
    await createSession({ userId: user.id, tokenId, expiresAt: new Date(claims.exp * 1000) });
    await pool.execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    res.cookie('meditrack_session', token, cookieOptions());
    res.json({ user: { id: user.id, pharmacyId: user.pharmacyId, fullName: user.fullName, email: user.email, role: user.role } });
  } catch (error) { next(error); }
});

router.post('/logout', async (req, res, next) => {
  const token = req.cookies?.meditrack_session;
  if (token) {
    try {
      const claims = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], ignoreExpiration: true });
      if (claims.sub && claims.jti) await revokeSession({ userId: claims.sub, tokenId: claims.jti });
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' || error.name === 'NotBeforeError') {
        // Invalid or expired cookies are still cleared; they cannot authenticate a request.
      } else {
        res.clearCookie('meditrack_session', { httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite, path: '/' });
        return next(error);
      }
    }
  }
  res.clearCookie('meditrack_session', { httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite, path: '/' });
  res.status(204).end();
});

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

module.exports = router;
