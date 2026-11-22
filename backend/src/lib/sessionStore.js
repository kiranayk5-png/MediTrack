const crypto = require('node:crypto');
const pool = require('../db');

function hashTokenId(tokenId) {
  return crypto.createHash('sha256').update(tokenId).digest('hex');
}

async function createSession({ userId, tokenId, expiresAt }) {
  return pool.execute(
    'INSERT INTO auth_sessions (user_id,token_hash,expires_at) VALUES (?,?,?)',
    [userId, hashTokenId(tokenId), expiresAt],
  );
}

async function findActiveSessionUser({ userId, tokenId }) {
  const [rows] = await pool.execute(
    `SELECT u.id,u.pharmacy_id AS pharmacyId,u.full_name AS fullName,u.email,r.name AS role
     FROM auth_sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id
     WHERE s.user_id=? AND s.token_hash=? AND s.revoked_at IS NULL
       AND s.expires_at>CURRENT_TIMESTAMP(3) AND u.is_active=TRUE LIMIT 1`,
    [userId, hashTokenId(tokenId)],
  );
  return rows[0] || null;
}

async function revokeSession({ userId, tokenId }) {
  const [result] = await pool.execute(
    `UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP(3)
     WHERE user_id=? AND token_hash=? AND revoked_at IS NULL`,
    [userId, hashTokenId(tokenId)],
  );
  return result.affectedRows === 1;
}

async function cleanupSessions() {
  const config = require('../config');
  const [expiredResult] = await pool.execute(
    `DELETE FROM auth_sessions
     WHERE expires_at <= CURRENT_TIMESTAMP(3)
     ORDER BY expires_at ASC
     LIMIT ?`,
    [config.authSessionCleanupBatchSize],
  );
  const [revokedResult] = await pool.execute(
    `DELETE FROM auth_sessions
     WHERE revoked_at IS NOT NULL
       AND revoked_at <= TIMESTAMPADD(DAY, -?, CURRENT_TIMESTAMP(3))
     ORDER BY revoked_at ASC
     LIMIT ?`,
    [config.authSessionCleanupRetentionDays, config.authSessionCleanupBatchSize],
  );
  return {
    expiredDeleted: expiredResult.affectedRows,
    revokedDeleted: revokedResult.affectedRows,
    retentionDays: config.authSessionCleanupRetentionDays,
    batchSize: config.authSessionCleanupBatchSize,
  };
}

module.exports = { hashTokenId, createSession, findActiveSessionUser, revokeSession, cleanupSessions };
