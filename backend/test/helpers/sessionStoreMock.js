const revoked = new Set();

const store = {
  createSession: jest.fn(async () => [{ affectedRows: 1 }, []]),
  findActiveSessionUser: jest.fn(async ({ userId, tokenId, claims }) => {
    if (!tokenId || revoked.has(tokenId)) return null;
    return {
      id: Number(userId), pharmacyId: claims.pharmacyId ?? null, role: claims.role,
      fullName: claims.fullName, email: claims.email,
    };
  }),
  revokeSession: jest.fn(async ({ tokenId }) => {
    if (!tokenId) return false;
    revoked.add(tokenId);
    return true;
  }),
  reset() {
    revoked.clear();
    store.createSession.mockClear();
    store.findActiveSessionUser.mockClear();
    store.revokeSession.mockClear();
  },
};

module.exports = store;
