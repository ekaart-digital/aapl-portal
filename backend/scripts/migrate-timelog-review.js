// One-off, safe-to-repeat migration for databases created before session
// review existed: adds the auto-stop flag and the manager correction trail
// to time_logs. Fresh databases get these columns from schema.sql already.
//
// Usage: node scripts/migrate-timelog-review.js

require('dotenv').config();
const pool = require('../src/config/db');

const COLUMNS = [
  ['auto_stopped', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER log_date'],
  ['edited_by', 'INT NULL AFTER auto_stopped'],
  ['edited_at', 'DATETIME NULL AFTER edited_by'],
  ['note', 'VARCHAR(500) NULL AFTER edited_at'],
];

async function exists(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows.length > 0;
}

(async () => {
  const db = process.env.DB_NAME;

  for (const [name, definition] of COLUMNS) {
    const has = await exists(
      'SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
      [db, 'time_logs', name]
    );
    if (has) { console.log(`column ${name}: already there`); continue; }
    await pool.query(`ALTER TABLE time_logs ADD COLUMN ${name} ${definition}`);
    console.log(`column ${name}: added`);
  }

  const hasFk = await exists(
    'SELECT 1 FROM information_schema.table_constraints WHERE table_schema = ? AND table_name = ? AND constraint_name = ?',
    [db, 'time_logs', 'fk_timelog_editor']
  );
  if (!hasFk) {
    await pool.query('ALTER TABLE time_logs ADD CONSTRAINT fk_timelog_editor FOREIGN KEY (edited_by) REFERENCES employees(employee_id) ON DELETE SET NULL');
    console.log('constraint fk_timelog_editor: added');
  }

  const hasIdx = await exists(
    'SELECT 1 FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?',
    [db, 'time_logs', 'idx_timelogs_review']
  );
  if (!hasIdx) {
    await pool.query('CREATE INDEX idx_timelogs_review ON time_logs (auto_stopped, edited_at)');
    console.log('index idx_timelogs_review: added');
  }

  console.log('Migration complete.');
  await pool.end();
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
