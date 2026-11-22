const pool = require('../src/db');
const { createSession, findActiveSessionUser, hashTokenId, revokeSession, cleanupSessions } = require('../src/lib/sessionStore');
const config = require('../src/config');

jest.mock('../src/db', () => ({ execute: jest.fn() }));

describe('persistent authentication session store', () => {
  beforeEach(() => pool.execute.mockReset());

  test('stores only a one-way hash of the JWT ID', async () => {
    const tokenId = 'opaque-jwt-id-for-unit-test';
    pool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await createSession({ userId: 7, tokenId, expiresAt: new Date('2030-01-01T00:00:00Z') });
    expect(pool.execute.mock.calls[0][0]).toContain('INSERT INTO auth_sessions');
    expect(pool.execute.mock.calls[0][1]).toEqual([7, hashTokenId(tokenId), new Date('2030-01-01T00:00:00Z')]);
    expect(pool.execute.mock.calls[0][1]).not.toContain(tokenId);
  });

  test('resolves current active role and pharmacy and requires unrevoked unexpired active user state', async () => {
    pool.execute.mockResolvedValueOnce([[{ id: 7, pharmacyId: 4, role: 'pharmacy_manager' }], []]);
    const user = await findActiveSessionUser({ userId: '7', tokenId: 'session-id' });
    expect(user).toMatchObject({ pharmacyId: 4, role: 'pharmacy_manager' });
    const [sql, params] = pool.execute.mock.calls[0];
    expect(sql).toContain('JOIN users u');
    expect(sql).toContain('JOIN roles r');
    expect(sql).toContain('s.revoked_at IS NULL');
    expect(sql).toContain('s.expires_at>CURRENT_TIMESTAMP(3)');
    expect(sql).toContain('u.is_active=TRUE');
    expect(params).toEqual(['7', hashTokenId('session-id')]);
  });

  test('revokes only the matching user session', async () => {
    pool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    expect(await revokeSession({ userId: '7', tokenId: 'session-id' })).toBe(true);
    expect(pool.execute.mock.calls[0][0]).toContain('UPDATE auth_sessions SET revoked_at');
    expect(pool.execute.mock.calls[0][1]).toEqual(['7', hashTokenId('session-id')]);
  });

  test('cleanup deletes only expired or sufficiently old revoked sessions in bounded indexed batches', async () => {
    pool.execute
      .mockResolvedValueOnce([{ affectedRows: 12 }, []])
      .mockResolvedValueOnce([{ affectedRows: 3 }, []]);

    const result = await cleanupSessions();
    const [expiredSql, expiredParams] = pool.execute.mock.calls[0];
    const [revokedSql, revokedParams] = pool.execute.mock.calls[1];
    expect(expiredSql).toContain('expires_at <= CURRENT_TIMESTAMP(3)');
    expect(expiredSql).toContain('ORDER BY expires_at ASC');
    expect(expiredSql).toContain('LIMIT ?');
    expect(expiredParams).toEqual([config.authSessionCleanupBatchSize]);
    expect(revokedSql).toContain('revoked_at IS NOT NULL');
    expect(revokedSql).toContain('revoked_at <= TIMESTAMPADD(DAY, -?, CURRENT_TIMESTAMP(3))');
    expect(revokedSql).toContain('ORDER BY revoked_at ASC');
    expect(revokedSql).toContain('LIMIT ?');
    expect(revokedParams).toEqual([config.authSessionCleanupRetentionDays, config.authSessionCleanupBatchSize]);
    expect(revokedSql).not.toContain('Date.now');
    expect(result).toEqual({ expiredDeleted: 12, revokedDeleted: 3, retentionDays: config.authSessionCleanupRetentionDays, batchSize: config.authSessionCleanupBatchSize });
  });

  test('a database cleanup error is surfaced to the standalone runner and does not retry unbounded work', async () => {
    pool.execute.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(cleanupSessions()).rejects.toThrow('database unavailable');
    expect(pool.execute).toHaveBeenCalledTimes(1);
  });
});
