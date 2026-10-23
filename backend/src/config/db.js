const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

// DigitalOcean (and most managed MySQL providers) require TLS. If DB_SSL_CA
// points to a downloaded CA certificate, use it for full verification;
// otherwise fall back to an encrypted-but-unverified connection so this
// still works out of the box against a DO cluster with minimal setup.
function buildSslConfig() {
  if (process.env.DB_SSL === 'false') return undefined;
  if (process.env.DB_SSL_CA) {
    return { ca: fs.readFileSync(process.env.DB_SSL_CA), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: buildSslConfig(),
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  dateStrings: true, // return DATE/DATETIME as 'YYYY-MM-DD[ HH:MM:SS]' strings, not JS Date objects
});

module.exports = pool;
