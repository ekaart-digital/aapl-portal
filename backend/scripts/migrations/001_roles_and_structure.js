// SRS §34 roles and §6 organisation structure:
//  - employees.role grows from {manager, employee} to the seven roles; every
//    existing "manager" becomes a Project Manager (what they effectively were)
//  - teams (one department, one Team Leader), departments.head_id
//  - employees.team_id, date_of_joining, mobile_number

const { hasTable, hasIndex, addColumn, addConstraint } = require('./helpers');

const NEW_ROLES = "'employee','team_leader','department_head','project_manager','hr_admin','management','system_admin'";

exports.name = '001_roles_and_structure';

exports.up = async (pool) => {
  // Widen the enum first (keeping 'manager'), convert, then drop 'manager'.
  await pool.query(`ALTER TABLE employees MODIFY role ENUM('manager',${NEW_ROLES}) NOT NULL DEFAULT 'employee'`);
  const [converted] = await pool.query("UPDATE employees SET role = 'project_manager' WHERE role = 'manager'");
  if (converted.affectedRows) console.log(`  converted ${converted.affectedRows} manager account(s) to project_manager`);
  await pool.query(`ALTER TABLE employees MODIFY role ENUM(${NEW_ROLES}) NOT NULL DEFAULT 'employee'`);

  if (!(await hasTable(pool, 'teams'))) {
    await pool.query(`
      CREATE TABLE teams (
        team_id         INT AUTO_INCREMENT PRIMARY KEY,
        name             VARCHAR(100) NOT NULL,
        department_id    INT NOT NULL,
        leader_id        INT NULL,
        created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_team_name_per_dept (department_id, name),
        CONSTRAINT fk_team_department FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE RESTRICT,
        CONSTRAINT fk_team_leader FOREIGN KEY (leader_id) REFERENCES employees(employee_id) ON DELETE SET NULL,
        KEY idx_teams_leader (leader_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  await addColumn(pool, 'departments', 'head_id', 'INT NULL AFTER name');
  await addConstraint(pool, 'departments', 'fk_department_head',
    'FOREIGN KEY (head_id) REFERENCES employees(employee_id) ON DELETE SET NULL');

  await addColumn(pool, 'employees', 'team_id', 'INT NULL AFTER department_id');
  await addColumn(pool, 'employees', 'date_of_joining', 'DATE NULL AFTER status');
  await addColumn(pool, 'employees', 'mobile_number', 'VARCHAR(30) NULL AFTER date_of_joining');
  await addConstraint(pool, 'employees', 'fk_employee_team',
    'FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE SET NULL');
  if (!(await hasIndex(pool, 'employees', 'idx_employees_team'))) {
    await pool.query('CREATE INDEX idx_employees_team ON employees (team_id)');
  }
};
