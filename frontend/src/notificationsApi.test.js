import test from 'node:test';
import assert from 'node:assert/strict';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from './notificationsApi.js';

test('notification filtering sends server pagination and unread state', async () => {
  const calls = [];
  await listNotifications({ page: 3, status: 'unread', type: 'low_stock', severity: 'critical' }, async (...args) => { calls.push(args); return {}; });
  const url = new URL(`http://local${calls[0][0]}`);
  assert.equal(url.pathname, '/notifications');
  assert.equal(url.searchParams.get('page'), '3');
  assert.equal(url.searchParams.get('limit'), '20');
  assert.equal(url.searchParams.get('status'), 'unread');
  assert.equal(url.searchParams.get('type'), 'low_stock');
  assert.equal(url.searchParams.get('severity'), 'critical');
});

test('individual and bulk read actions use the authenticated API endpoints', async () => {
  const calls = [];
  const request = async (...args) => { calls.push(args); return { updated: 2 }; };
  await markNotificationRead(19, request);
  await markAllNotificationsRead(request);
  assert.deepEqual(calls, [
    ['/notifications/19/read', { method: 'PATCH' }],
    ['/notifications/read-all', { method: 'POST', body: '{}' }],
  ]);
});
