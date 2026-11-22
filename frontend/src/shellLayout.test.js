import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shell = await readFile(new URL('./components/Shell.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

test('shell exposes an independently scrollable, labelled navigation and an explicit logout action', () => {
  assert.match(shell, /<nav aria-label="Main navigation" className="side-nav">/);
  assert.match(shell, /aria-label="Open navigation"/);
  assert.match(shell, /Log out/);
  assert.match(shell, /to="\/notifications"/);
  assert.match(shell, /notification-count/);
  assert.match(shell, /Collapse sidebar/);
  assert.match(shell, /setCollapsed\(\(value\) => !value\)/);
  assert.match(styles, /\.sidebar\.collapsed\s*\{[^}]*width:\s*76px/);
  assert.match(shell, /await logout\(\)/);
  assert.match(styles, /\.side-nav\s*\{[^}]*overflow-y:\s*auto/);
});

test('main workspace has its own scroll container and visible keyboard focus styles', () => {
  assert.match(styles, /\.main-area\s*\{[^}]*overflow:\s*hidden/);
  assert.match(styles, /\.page-content\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(styles, /button:focus-visible, a:focus-visible/);
  assert.match(styles, /height:\s*100dvh/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});
