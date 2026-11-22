import test from 'node:test';
import assert from 'node:assert/strict';
import { logoutSession } from './authSession.js';

test('logout invalidates the server session before clearing local user state', async () => {
  const calls = [];
  await logoutSession(async (...args) => { calls.push(['request', ...args]); }, (value) => calls.push(['clear', value]));
  assert.deepEqual(calls, [
    ['request', '/auth/logout', { method: 'POST' }],
    ['clear', null],
  ]);
});

test('failed logout keeps local authentication state intact for retry', async () => {
  let currentUser = { id: 9 };
  await assert.rejects(logoutSession(async () => { throw new Error('offline'); }, (value) => { currentUser = value; }), /offline/);
  assert.deepEqual(currentUser, { id: 9 });
});
