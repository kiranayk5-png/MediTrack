const { AppError } = require('../lib/errors');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const NON_BROWSER_CLIENT_HEADER = 'x-meditrack-client';
const NON_BROWSER_CLIENT_VALUE = 'non-browser';

function createOriginGuard(allowedOrigin) {
  return function originGuard(req, _res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get('origin');
    if (origin) {
      if (origin !== allowedOrigin) {
        return next(new AppError(403, 'This request origin is not allowed.', 'ORIGIN_REJECTED'));
      }
      return next();
    }

    // Browser clients cannot add this non-simple header cross-origin without a
    // successful CORS preflight. It preserves explicit server/CLI integrations
    // that have no Origin header without weakening browser-origin checks.
    if (req.get(NON_BROWSER_CLIENT_HEADER) === NON_BROWSER_CLIENT_VALUE) return next();
    return next(new AppError(403, 'A trusted Origin header is required for this request.', 'ORIGIN_REQUIRED'));
  };
}

module.exports = { createOriginGuard, SAFE_METHODS, NON_BROWSER_CLIENT_HEADER, NON_BROWSER_CLIENT_VALUE };
