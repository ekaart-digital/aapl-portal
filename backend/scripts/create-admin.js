// Creates the first System Administrator, so a new installation can be used
// without the demo accounts (which all share a known password).
//
// Usage:
//   ADMIN_NAME="Full Name" ADMIN_EMAIL=name@company.com node scripts/create-admin.js
//   ADMIN_PASSWORD=...   optional; when left out a strong one is generated and printed once
//
// Reads DB_* settings from .env. Refuses to run if the email already exists.

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');
const { assertStrongPassword } = require('../src/utils/password');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 16 characters from a readable alphabet, always with letters and digits.
function generatePassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = letters + digits;
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(letters), pick(letters), pick(digits), pick(digits)];
  while (chars.length < 16) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

(async () => {
  const name = (process.env.ADMIN_NAME || '').trim();
  const email = (process.env.ADMIN_EMAIL || '').trim();
  if (!name) throw new Error('Set ADMIN_NAME.');
  if (!EMAIL_RE.test(email)) throw new Error('Set ADMIN_EMAIL to a valid email address.');

  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || generatePassword();
  assertStrongPassword(password, 'ADMIN_PASSWORD');

  const [existing] = await pool.query('SELECT employee_id FROM employees WHERE email = ?', [email]);
  if (existing.length) throw new Error(`An account with ${email} already exists.`);

  const [result] = await pool.query(
    `INSERT INTO employees (name, email, password_hash, designation, role, status, date_of_joining)
     VALUES (?, ?, ?, 'System Administrator', 'system_admin', 'active', CURDATE())`,
    [name, email, await bcrypt.hash(password, 10)]
  );
  console.log(`Created System Administrator "${name}".`);
  console.log(`Employee ID: EMP-${String(result.insertId).padStart(3, '0')}`);
  if (generated) console.log(`Password:    ${password}`);
  else console.log('Password:    (the one you supplied)');
  console.log('Sign in and change the password from the user menu.');
  await pool.end();
})().catch(async (err) => {
  console.error('FAILED:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
