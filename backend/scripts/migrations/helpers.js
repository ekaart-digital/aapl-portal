// Small existence checks so migrations can be re-run safely.
const dbName = () => process.env.DB_NAME;

async function hasColumn(pool, table, column) {
  const [rows] = await pool.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
    [dbName(), table, column]
  );
  return rows.length > 0;
}

async function hasTable(pool, table) {
  const [rows] = await pool.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [dbName(), table]
  );
  return rows.length > 0;
}

async function hasConstraint(pool, table, name) {
  const [rows] = await pool.query(
    'SELECT 1 FROM information_schema.table_constraints WHERE table_schema = ? AND table_name = ? AND constraint_name = ?',
    [dbName(), table, name]
  );
  return rows.length > 0;
}

async function hasIndex(pool, table, name) {
  const [rows] = await pool.query(
    'SELECT 1 FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?',
    [dbName(), table, name]
  );
  return rows.length > 0;
}

async function addColumn(pool, table, column, definition) {
  if (await hasColumn(pool, table, column)) return false;
  await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

async function addConstraint(pool, table, name, ddl) {
  if (await hasConstraint(pool, table, name)) return false;
  await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${ddl}`);
  return true;
}

module.exports = { hasColumn, hasTable, hasConstraint, hasIndex, addColumn, addConstraint };
