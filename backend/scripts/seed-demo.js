// Loads (or clears) demo data for showing the platform to the client.
//
// Usage:
//   node scripts/seed-demo.js           load demo data into an empty database
//   node scripts/seed-demo.js leadership  add Department Heads, Team Leaders and a Managing Director
//                                         (needs DEMO_PASSWORD, the one the other accounts use)
//   node scripts/seed-demo.js clear     remove all business data again (needs --yes)
//
// Every demo account shares one password: DEMO_PASSWORD if set, otherwise a
// generated one that is printed once. System Administrator accounts are never
// touched.

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');
const { assertStrongPassword } = require('../src/utils/password');
const { seedDemo, addLeadership, clearDemo } = require('./lib/demoData');

function generatePassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(letters), pick(letters), pick(digits), pick(digits)];
  while (chars.length < 14) chars.push(pick(letters + digits));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

(async () => {
  if (process.argv[2] === 'clear') {
    if (!process.argv.includes('--yes')) throw new Error('This removes all departments, people (except System Administrators), projects, tasks and hours. Add --yes to go ahead.');
    await clearDemo(pool);
    console.log('Removed all business data. System Administrator accounts were kept.');
    return;
  }

  if (process.argv[2] === 'leadership') {
    const password = process.env.DEMO_PASSWORD;
    if (!password) throw new Error('Set DEMO_PASSWORD to the password the other demo accounts use.');
    assertStrongPassword(password, 'DEMO_PASSWORD');
    const { accounts } = await addLeadership(pool, await bcrypt.hash(password, 10));
    console.log(`Added ${accounts.length} accounts. They use the same password as the other demo accounts.\n`);
    for (const a of accounts) console.log(`  EMP-${String(a.id).padStart(3, '0')}  ${a.role.padEnd(16)} ${a.name}`);
    return;
  }

  const password = process.env.DEMO_PASSWORD || generatePassword();
  assertStrongPassword(password, 'DEMO_PASSWORD');
  const { accounts, counts } = await seedDemo(pool, await bcrypt.hash(password, 10));

  console.log(`Loaded ${counts.departments} departments, ${counts.teams} teams, ${counts.people} people and ${counts.projects} projects.\n`);
  console.log('Sign in with the Employee ID. Every demo account uses the same password.');
  console.log(`Password: ${password}\n`);
  for (const a of accounts) console.log(`  EMP-${String(a.id).padStart(3, '0')}  ${a.role.padEnd(16)} ${a.name}`);
})().then(() => pool.end(), async (err) => {
  console.error('FAILED:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
