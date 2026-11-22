import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const frontendRoot = new URL('../', import.meta.url);

test('Vercel rewrites React Router paths to the SPA entry point', () => {
  const configuration = JSON.parse(fs.readFileSync(new URL('vercel.json', frontendRoot), 'utf8'));
  assert.deepEqual(configuration.rewrites, [{ source: '/(.*)', destination: '/index.html' }]);
});

test('frontend API client uses a configurable API URL and credentialed requests', () => {
  const apiClient = fs.readFileSync(new URL('src/api.js', frontendRoot), 'utf8');
  assert.match(apiClient, /import\.meta\.env\.VITE_API_URL/);
  assert.match(apiClient, /credentials:\s*'include'/);
});
