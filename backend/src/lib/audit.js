async function writeAudit(conn, { pharmacyId = null, userId = null, action, entityType, entityId = null, details = null }) {
  await conn.execute(
    'INSERT INTO audit_logs (pharmacy_id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
    [pharmacyId, userId, action, entityType, entityId, details == null ? null : JSON.stringify(details)],
  );
}

module.exports = { writeAudit };
