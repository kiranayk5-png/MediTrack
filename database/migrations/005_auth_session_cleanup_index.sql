-- Add the index needed for efficient bounded deletion of retained revoked sessions.
-- Additive only. Apply manually after migration 004 has created auth_sessions.
ALTER TABLE auth_sessions
    ADD INDEX idx_auth_sessions_revoked_at (revoked_at);
