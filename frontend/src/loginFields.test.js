import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('login icon inputs retain leading-icon spacing after shared field styles', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
  const login = await readFile(new URL('./pages/LoginPage.jsx', import.meta.url), 'utf8');
  assert.match(login, /className="input-icon has-password-toggle"/);
  assert.match(styles, /\.login-form \.input-icon > input\s*\{[^}]*padding:\s*0 14px 0 44px/);
  assert.match(styles, /\.login-form \.input-icon\.has-password-toggle > input\s*\{[^}]*padding-right:\s*54px/);
  assert.match(styles, /\.login-form \.input-icon > svg\s*\{[^}]*left:\s*14px/);
});

test('password visibility control remains positioned at the field trailing edge and accessible', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
  const login = await readFile(new URL('./pages/LoginPage.jsx', import.meta.url), 'utf8');
  assert.match(styles, /\.login-form \.password-toggle\s*\{[^}]*right:\s*7px/);
  assert.match(login, /aria-label=\{showPassword \? 'Hide password' : 'Show password'\}/);
});
