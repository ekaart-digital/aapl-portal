// Creates the application database (if it does not exist) and loads the full
// current schema into it. For a brand-new installation, for example a new
// server. Safe to run again: every table is created only if it is missing.
//
// Then run `npm run migrate` to record the migrations, and
// `node scripts/create-admin.js` to create the first administrator.
//
// Usage: node scripts/init-db.js   (reads DB_* settings from .env)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function ssl() {
  if (process.env.DB_SSL === 'false') return undefined;
  if (process.env.DB_SSL_CA) return { ca: fs.readFileSync(process.env.DB_SSL_CA), rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

(async () => {
  const name = process.env.DB_NAME;
  if (!name || !/^[A-Za-z0-9_]+$/.test(name)) throw new Error('Set DB_NAME to a database name made of letters, numbers and underscores.');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: ssl(),
    multipleStatements: true,
  });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4`);
    await conn.query(`USE \`${name}\``);
    await conn.query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
    const [tables] = await conn.query('SHOW TABLES');
    console.log(`Database "${name}" is ready with ${tables.length} tables.`);
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
