const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  resolveHost,
  parseBoolean,
  normalizeFrontendOrigin,
  createMysqlTlsOptions,
} = require('../src/lib/runtimeConfig');

describe('deployment configuration helpers', () => {
  test('binds to all interfaces in production while keeping local development loopback-only', () => {
    expect(resolveHost('production')).toBe('0.0.0.0');
    expect(resolveHost('development')).toBe('127.0.0.1');
    expect(resolveHost('production', '10.0.0.5')).toBe('10.0.0.5');
  });

  test('parses TLS and cookie booleans strictly', () => {
    expect(parseBoolean('DB_SSL', undefined, false)).toBe(false);
    expect(parseBoolean('DB_SSL', 'TRUE', false)).toBe(true);
    expect(() => parseBoolean('DB_SSL', 'yes', false)).toThrow('DB_SSL must be true or false');
  });

  test('normalizes a frontend origin and requires HTTPS in production', () => {
    expect(normalizeFrontendOrigin('https://app.example.test/', 'production')).toBe('https://app.example.test');
    expect(() => normalizeFrontendOrigin('http://app.example.test', 'production')).toThrow('must use HTTPS');
    expect(() => normalizeFrontendOrigin('https://app.example.test/path', 'production')).toThrow('without a path');
  });

  test('keeps MySQL TLS off locally unless enabled', () => {
    expect(createMysqlTlsOptions({ enabled: false })).toBeUndefined();
  });

  test('enables verified TLS with a provider CA and never disables certificate checks', () => {
    const options = createMysqlTlsOptions({ enabled: true, ca: 'test provider CA' });
    expect(options).toMatchObject({ rejectUnauthorized: true, minVersion: 'TLSv1.2', ca: 'test provider CA' });
  });

  test('loads a provider CA from a certificate file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meditrack-ca-'));
    const caFile = path.join(directory, 'provider-ca.pem');
    try {
      fs.writeFileSync(caFile, 'test certificate authority');
      expect(createMysqlTlsOptions({ enabled: true, caFile })).toMatchObject({
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        ca: 'test certificate authority',
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('fails production configuration when cloud database TLS is disabled', () => {
    const backendRoot = path.resolve(__dirname, '..');
    const result = spawnSync(process.execPath, ['-e', "require('./src/config')"], {
      cwd: backendRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        FRONTEND_ORIGIN: 'https://app.example.test',
        DB_HOST: 'mysql.example.test',
        DB_USER: 'meditrack_runtime_test',
        DB_PASSWORD: 'test-only-placeholder',
        DB_NAME: 'meditrack_test',
        DB_SSL: 'false',
        COOKIE_SECURE: 'true',
        JWT_SECRET: 'a'.repeat(48),
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('DB_SSL=true is required in production');
  });
});
