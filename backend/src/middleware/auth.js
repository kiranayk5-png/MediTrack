const jwt = require('jsonwebtoken');
const config = require('../config');
const { AppError } = require('../lib/errors');
const { findActiveSessionUser } = require('../lib/sessionStore');

async function authenticate(req, _res, next) {
  const token = req.cookies?.meditrack_session;
  if (!token) return next(new AppError(401, 'Please sign in to continue.', 'UNAUTHENTICATED'));
  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (_error) {
    return next(new AppError(401, 'Your session has expired. Please sign in again.', 'INVALID_SESSION'));
  }
  if (!claims.sub || !claims.jti || !/^\d+$/.test(String(claims.sub))) {
    return next(new AppError(401, 'Your session is invalid. Please sign in again.', 'INVALID_SESSION'));
  }
  try {
    const currentUser = await findActiveSessionUser({ userId: claims.sub, tokenId: claims.jti, claims });
    if (!currentUser) return next(new AppError(401, 'Your session is no longer active. Please sign in again.', 'INVALID_SESSION'));
    req.user = {
      id: Number(currentUser.id),
      pharmacyId: currentUser.pharmacyId == null ? null : Number(currentUser.pharmacyId),
      role: currentUser.role,
      fullName: currentUser.fullName,
      email: currentUser.email,
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

function allowRoles(...roles) {
  return (req, _res, next) => roles.includes(req.user?.role)
    ? next()
    : next(new AppError(403, 'You do not have permission to perform this action.', 'FORBIDDEN'));
}

function pharmacyScope(req) {
  if (req.user.role === 'platform_admin') {
    const requested = req.params.pharmacyId || req.query.pharmacyId || req.body?.pharmacyId;
    if (!requested) return null;
    const id = Number(requested);
    if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(400, 'Pharmacy ID must be a positive integer.', 'INVALID_PHARMACY');
    return id;
  }
  if (!req.user.pharmacyId) throw new AppError(403, 'This account is not assigned to a pharmacy.', 'PHARMACY_REQUIRED');
  return req.user.pharmacyId;
}

module.exports = { authenticate, allowRoles, pharmacyScope };
