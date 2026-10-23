// One-off, safe-to-repeat migration: creates the notifications table on a
// database that was set up before notifications existed. Fresh databases get
// it from schema.sql already.
//
// Usage: node scripts/migrate-notifications.js

require('dotenv').config();
const pool = require('../src/config/db');

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      notification_id  INT AUTO_INCREMENT PRIMARY KEY,
      recipient_id     INT NOT NULL,
      type             VARCHAR(40) NOT NULL,
      severity         ENUM('info','attention','critical') NOT NULL DEFAULT 'info',
      title            VARCHAR(200) NOT NULL,
      body             VARCHAR(500) NOT NULL DEFAULT '',
      link             VARCHAR(200) NULL,
      dedupe_key       VARCHAR(120) NULL,
      is_read          TINYINT(1) NOT NULL DEFAULT 0,
      read_at          DATETIME NULL,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_notification_recipient
        FOREIGN KEY (recipient_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
      UNIQUE KEY uq_notification_dedupe (recipient_id, dedupe_key),
      KEY idx_notification_inbox (recipient_id, is_read, notification_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('notifications table: ready');
  await pool.end();
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
