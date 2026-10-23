// SRS §35 audit trail and employee correction requests.
//  - correction_requests: an employee asks for a finished session to be
//    credited differently; the people who review that person's time decide.
//  - audit_log: who changed what, and when. Names and roles are copied into
//    each row so the trail stays readable if a person is later renamed.

const { hasTable } = require('./helpers');

exports.name = '003_corrections_and_audit';

exports.up = async (pool) => {
  if (!(await hasTable(pool, 'correction_requests'))) {
    await pool.query(`
      CREATE TABLE correction_requests (
        request_id         INT AUTO_INCREMENT PRIMARY KEY,
        log_id             INT NOT NULL,
        employee_id        INT NOT NULL,
        original_minutes   INT NOT NULL,
        requested_minutes  INT NOT NULL,
        reason             VARCHAR(500) NOT NULL,
        status             ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        reviewer_id        INT NULL,
        reviewed_at        DATETIME NULL,
        review_note        VARCHAR(500) NULL,
        created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_correction_log FOREIGN KEY (log_id) REFERENCES time_logs(log_id) ON DELETE CASCADE,
        CONSTRAINT fk_correction_employee FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
        CONSTRAINT fk_correction_reviewer FOREIGN KEY (reviewer_id) REFERENCES employees(employee_id) ON DELETE SET NULL,
        KEY idx_correction_status (status, created_at),
        KEY idx_correction_employee (employee_id),
        KEY idx_correction_log (log_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  if (!(await hasTable(pool, 'audit_log'))) {
    await pool.query(`
      CREATE TABLE audit_log (
        audit_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
        actor_id      INT NULL,
        actor_name    VARCHAR(100) NOT NULL,
        actor_role    VARCHAR(30) NULL,
        action        VARCHAR(60) NOT NULL,
        entity_type   VARCHAR(40) NOT NULL,
        entity_id     INT NULL,
        summary       VARCHAR(300) NOT NULL,
        details       JSON NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_audit_created (created_at),
        KEY idx_audit_entity (entity_type, entity_id),
        KEY idx_audit_actor (actor_id),
        KEY idx_audit_action (action)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }
};
