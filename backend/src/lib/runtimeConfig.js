const fs = require('node:fs');

function resolveHost(nodeEnv, configuredHost) {
  if (configuredHost) return configuredHost;
  return nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1';
}

function parseBoolean(name, value, fallback) {
  if (value == null || value === '') return fallback;
  if (String(value).toLowerCase() === 'true') return true;
  if (String(value).toLowerCase() === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function normalizeFrontendOrigin(value, nodeEnv = 'development') {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('FRONTEND_ORIGIN must be a valid origin URL');
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('FRONTEND_ORIGIN must contain only scheme and host, without a path');
  }
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
    throw new Error('FRONTEND_ORIGIN must use HTTPS in production');
  }
  return parsed.origin;
}

function createMysqlTlsOptions({ enabled, ca, caFile }) {
  if (!enabled) return undefined;
  if (ca && caFile) throw new Error('Configure only one MySQL CA source');

  let certificateAuthority = ca || '';
  if (caFile) certificateAuthority = fs.readFileSync(caFile, 'utf8');
  if (caFile && !certificateAuthority.trim()) throw new Error('The configured MySQL CA file is empty');

  return {
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    ...(certificateAuthority ? { ca: certificateAuthority } : {}),
  };
}

module.exports = { resolveHost, parseBoolean, normalizeFrontendOrigin, createMysqlTlsOptions };
