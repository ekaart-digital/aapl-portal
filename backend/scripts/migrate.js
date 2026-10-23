// Applies database migrations from scripts/migrations/ in order and records
// each one in schema_migrations, so running it again does nothing new.
// Every migration is also written to be safe to run on a database that
// already has its changes (for example one built from the latest schema.sql).
//
// Usage: npm run migrate

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

const DIR = path.join(__dirname, 'migrations');

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(100) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [applied] = await pool.query('SELECT name FROM schema_migrations');
  const done = new Set(applied.map((r) => r.name));

  const files = fs.readdirSync(DIR).filter((f) => /^\d{3}_.*\.js$/.test(f)).sort();
  let ran = 0;
  for (const file of files) {
    const name = path.basename(file, '.js');
    if (done.has(name)) { console.log(`skip   ${name}`); continue; }
    console.log(`apply  ${name}`);
    await require(path.join(DIR, file)).up(pool);
    await pool.query('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
    ran += 1;
  }
  console.log(ran ? `Done: ${ran} migration(s) applied.` : 'Database is up to date.');
}

main()
  .catch((err) => { console.error('FAILED:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
