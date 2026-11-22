const app = require('./app');
const pool = require('./db');
const config = require('./config');

async function start() {
  await pool.query('SELECT 1');
  app.listen(config.port, config.host, () => console.log(`MediTrack API listening on ${config.host}:${config.port}`));
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Could not connect to MySQL. Check backend/.env and database setup.', error.message);
    process.exit(1);
  });
}

module.exports = { start };
