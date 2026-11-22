const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { resolveHost, parseBoolean, normalizeFrontendOrigin } = require('./lib/runtimeConfig');

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

const nodeEnv = process.env.NODE_ENV || 'development';
const frontendOrigin = normalizeFrontendOrigin(process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5173', nodeEnv);
const dbSsl = parseBoolean('DB_SSL', process.env.DB_SSL, false);
const cookieSecure = parseBoolean('COOKIE_SECURE', process.env.COOKIE_SECURE, nodeEnv === 'production');
const dbSslCa = process.env.DB_SSL_CA || '';
const dbSslCaFile = process.env.DB_SSL_CA_FILE || '';

if (dbSslCa && dbSslCaFile) throw new Error('Set only one of DB_SSL_CA or DB_SSL_CA_FILE');
if (!dbSsl && (dbSslCa || dbSslCaFile)) throw new Error('DB_SSL=true is required when configuring a database CA');

const config = {
  nodeEnv,
  port: Number(process.env.PORT || 4000),
  host: resolveHost(nodeEnv, process.env.HOST),
  frontendOrigin,
  db: {
    host: required('DB_HOST', nodeEnv === 'production' ? undefined : '127.0.0.1'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER', nodeEnv === 'production' ? undefined : 'meditrack_app'),
    password: nodeEnv === 'production' ? required('DB_PASSWORD') : (process.env.DB_PASSWORD || ''),
    database: required('DB_NAME', nodeEnv === 'production' ? undefined : 'meditrack'),
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    ssl: dbSsl,
    sslCa: dbSslCa,
    sslCaFile: dbSslCaFile,
  },
  jwtSecret: required('JWT_SECRET', nodeEnv === 'test' ? 'test-secret-only-not-for-production' : undefined),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  cookieSecure,
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
if (config.nodeEnv === 'production' && !config.db.ssl) {
  throw new Error('DB_SSL=true is required in production');
}
if (config.nodeEnv === 'production' && !config.cookieSecure) {
  throw new Error('COOKIE_SECURE=true is required in production');
}

module.exports = config;
