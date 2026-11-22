const pool = require('../db');
const { cleanupSessions } = require('../lib/sessionStore');

async function run() {
  try {
    const result = await cleanupSessions();
    console.log(JSON.stringify({ event: 'auth_session_cleanup_complete', ...result }));
  } catch (_error) {
    // Keep logs free of query details and connection strings; the scheduler can
    // alert on the non-zero process status and operators can inspect DB health.
    console.error('Auth session cleanup failed. Check database availability and schema status.');
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {
      console.error('Database pool could not be closed cleanly after session cleanup.');
      process.exitCode = 1;
    });
  }
}

if (require.main === module) run();

module.exports = { run };
