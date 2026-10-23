// Completes the Version 1 data model against the requirements document:
//  - tasks.category (§14 task categories), tasks.completed_at (period summaries)
//  - projects: team leader (§13), agreed fee, manager-entered completion %
//  - employees: photograph and overtime eligibility (§6)

const { addColumn, addConstraint } = require('./helpers');

exports.name = '005_v1_completion';

exports.up = async (pool) => {
  await addColumn(pool, 'tasks', 'category', 'VARCHAR(40) NULL AFTER task_name');
  await addColumn(pool, 'tasks', 'completed_at', 'DATETIME NULL');
  // Tasks that were already completed: the best date we have is when they last changed.
  await pool.query("UPDATE tasks SET completed_at = updated_at WHERE status = 'Completed' AND completed_at IS NULL");

  await addColumn(pool, 'projects', 'team_leader_id', 'INT NULL AFTER project_manager_id');
  await addColumn(pool, 'projects', 'agreed_fee', 'DECIMAL(14,2) NULL');
  await addColumn(pool, 'projects', 'completion_override_percent', 'TINYINT UNSIGNED NULL');
  await addConstraint(pool, 'projects', 'fk_project_team_leader',
    'FOREIGN KEY (team_leader_id) REFERENCES employees(employee_id) ON DELETE SET NULL');

  await addColumn(pool, 'employees', 'photo', 'MEDIUMTEXT NULL');
  await addColumn(pool, 'employees', 'overtime_eligible', 'TINYINT(1) NOT NULL DEFAULT 0');
};
