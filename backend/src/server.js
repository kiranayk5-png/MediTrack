const app = require('./app');
const pool = require('./db');
const config = require('./config');

async function start() {
  await pool.query('SELECT 1');
  const host = process.env.HOST || '127.0.0.1';
  app.listen(config.port, host, () => console.log(`MediTrack API listening on http://${host}:${config.port}`));
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Could not connect to MySQL. Check backend/.env and database setup.', error.message);
    process.exit(1);
  });
}

module.exports = { start };
