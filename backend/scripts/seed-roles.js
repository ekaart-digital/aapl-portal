// Adds the demo accounts for the extra roles (Team Leader, Department Head,
// HR/Admin, Management, System Administrator) and one team per department to
// a database that was seeded before those roles existed. Safe to re-run.
//
// Usage: node scripts/seed-roles.js

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');
const { seedOrganisation } = require('./lib/seedOrganisation');

const DEMO_PASSWORD = 'Passw0rd!';

(async () => {
  const accounts = await seedOrganisation(pool, await bcrypt.hash(DEMO_PASSWORD, 10));
  console.log('Demo accounts for the extra roles (password for all: %s)', DEMO_PASSWORD);
  accounts.forEach((a) => console.log(`  EMP-${String(a.id).padStart(3, '0')}  ${a.role.padEnd(16)} ${a.name}${a.created ? '' : '  (already existed)'}`));
  await pool.end();
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
