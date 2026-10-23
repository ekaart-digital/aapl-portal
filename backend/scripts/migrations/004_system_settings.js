// Settings the System Administrator changes from the screen instead of a
// deployment (session length, man-hour thresholds, correction window, idle
// sign-out). See src/services/settings.js for what each one means.

const { hasTable } = require('./helpers');

exports.name = '004_system_settings';

exports.up = async (pool) => {
  if (await hasTable(pool, 'system_settings')) return;
  await pool.query(`
    CREATE TABLE system_settings (
      setting_key    VARCHAR(60) NOT NULL PRIMARY KEY,
      setting_value  VARCHAR(100) NOT NULL,
      updated_by     INT NULL,
      updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_setting_editor FOREIGN KEY (updated_by) REFERENCES employees(employee_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
};
