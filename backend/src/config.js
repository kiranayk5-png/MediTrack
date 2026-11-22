const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

function boundedInteger(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5173',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER', 'meditrack_app'),
    password: process.env.DB_PASSWORD || '',
    database: required('DB_NAME', 'meditrack'),
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  },
  jwtSecret: required('JWT_SECRET', process.env.NODE_ENV === 'test' ? 'test-secret-only-not-for-production' : undefined),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  cookieSecure: process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV || 'development') === 'production',
  cookieSameSite: process.env.COOKIE_SAME_SITE || 'lax',
  authSessionCleanupRetentionDays: boundedInteger('AUTH_SESSION_CLEANUP_RETENTION_DAYS', 30, 1, 3650),
  authSessionCleanupBatchSize: boundedInteger('AUTH_SESSION_CLEANUP_BATCH_SIZE', 500, 1, 5000),
};

if (!['lax', 'strict', 'none'].includes(config.cookieSameSite.toLowerCase())) {
  throw new Error('COOKIE_SAME_SITE must be lax, strict, or none');
}
if (config.cookieSameSite.toLowerCase() === 'none' && !config.cookieSecure) {
  throw new Error('COOKIE_SECURE=true is required when COOKIE_SAME_SITE=none');
}

if (config.nodeEnv === 'production' && config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

module.exports = config;
