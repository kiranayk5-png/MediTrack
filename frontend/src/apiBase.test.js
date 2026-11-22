import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApiUrl } from './apiBase.js';

test('uses the current 127.0.0.1 host when configured API points at localhost', () => {
  assert.equal(
    resolveApiUrl('http://localhost:4000/api', { protocol: 'http:', hostname: '127.0.0.1' }),
    'http://127.0.0.1:4000/api',
  );
});

test('derives the local API fallback from the frontend hostname', () => {
  assert.equal(
    resolveApiUrl(undefined, { protocol: 'http:', hostname: '127.0.0.1' }),
    'http://127.0.0.1:4000/api',
  );
});

test('keeps configured non-loopback API hosts unchanged', () => {
  assert.equal(
    resolveApiUrl('https://api.example.test/api', { protocol: 'https:', hostname: 'app.example.test' }),
    'https://api.example.test/api',
  );
});
