-- AAPL Platform — Version 1 Schema (Project & Task Management)
-- MySQL 8.0+. Run once against an empty database:
--   mysql -u root -p aapl_platform < schema.sql

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- departments — disciplines. head_id is the Department Head (SRS §34) who
-- sees everything in the department.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  department_id   INT AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(100) NOT NULL,
  head_id          INT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_departments_name (name),
  CONSTRAINT fk_department_head
    FOREIGN KEY (head_id) REFERENCES employees(employee_id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- teams — a team belongs to one department and has one Team Leader (SRS §6).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  team_id         INT AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(100) NOT NULL,
  department_id    INT NOT NULL,
  leader_id        INT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_name_per_dept (department_id, name),
  CONSTRAINT fk_team_department
    FOREIGN KEY (department_id) REFERENCES departments(department_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_team_leader
    FOREIGN KEY (leader_id) REFERENCES employees(employee_id)
    ON DELETE SET NULL,
  KEY idx_teams_leader (leader_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- sub_departments — department-specific (Piping's "Input Study" is a
-- different row from Structural's "Input Study")
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sub_departments (
  sub_department_id INT AUTO_INCREMENT PRIMARY KEY,
  department_id      INT NOT NULL,
  name                VARCHAR(100) NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subdept_per_dept (department_id, name),
  CONSTRAINT fk_subdept_department
    FOREIGN KEY (department_id) REFERENCES departments(department_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- employees — also the login/user table. role controls portal access.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  employee_id    INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(150) NOT NULL,
  email            VARCHAR(150) NOT NULL,
  password_hash    VARCHAR(255) NOT NULL,
  department_id    INT NULL,                     -- NULL for roles with no discipline
  team_id          INT NULL,
  designation      VARCHAR(150) NULL,
  -- SRS §34 roles. Exactly one per account; what each may see and do is
  -- decided in src/auth/permissions.js.
  role             ENUM('employee','team_leader','department_head','project_manager',
                        'hr_admin','management','system_admin') NOT NULL DEFAULT 'employee',
  status           ENUM('active','inactive') NOT NULL DEFAULT 'active',
  date_of_joining  DATE NULL,
  mobile_number    VARCHAR(30) NULL,
  photo            MEDIUMTEXT NULL,               -- small image as a data URL
  overtime_eligible TINYINT(1) NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employees_email (email),
  CONSTRAINT fk_employee_department
    FOREIGN KEY (department_id) REFERENCES departments(department_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_employee_team
    FOREIGN KEY (team_id) REFERENCES teams(team_id)
    ON DELETE SET NULL,
  KEY idx_employees_team (team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  project_id            INT AUTO_INCREMENT PRIMARY KEY,
  job_code                VARCHAR(50) NOT NULL,
  name                     VARCHAR(200) NOT NULL,
  client_name              VARCHAR(200) NOT NULL,
  consultant_name          VARCHAR(200) NULL,
  main_contractor_name     VARCHAR(200) NULL,
  map_contractor_name      VARCHAR(200) NULL,
  project_manager_id       INT NOT NULL,
  team_leader_id           INT NULL,
  start_date               DATE NULL,
  target_date              DATE NULL,
  actual_completion_date   DATE NULL,
  priority                 ENUM('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium',
  estimated_man_hours      DECIMAL(10,2) NOT NULL,
  agreed_fee               DECIMAL(14,2) NULL,
  -- A manager's own estimate of how complete the project is; when set it
  -- replaces the figure calculated from completed tasks.
  completion_override_percent TINYINT UNSIGNED NULL,
  status                   ENUM('Planning','In Progress','On Hold','Completed') NOT NULL DEFAULT 'Planning',
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_projects_job_code (job_code),
  CONSTRAINT fk_project_manager
    FOREIGN KEY (project_manager_id) REFERENCES employees(employee_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_project_team_leader
    FOREIGN KEY (team_leader_id) REFERENCES employees(employee_id)
    ON DELETE SET NULL,
  KEY idx_projects_manager (project_manager_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- project_departments — a project can span multiple departments (M:N)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_departments (
  project_id     INT NOT NULL,
  department_id   INT NOT NULL,
  PRIMARY KEY (project_id, department_id),
  CONSTRAINT fk_pd_project
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  CONSTRAINT fk_pd_department
    FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- tasks — the sub-department work item that ties project + employee together
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  task_id            INT AUTO_INCREMENT PRIMARY KEY,
  project_id          INT NOT NULL,
  sub_department_id    INT NOT NULL,
  employee_id          INT NOT NULL,
  task_name            VARCHAR(200) NOT NULL,
  category             VARCHAR(40) NULL,            -- SRS §14 task category
  allocated_hours      DECIMAL(10,2) NOT NULL,
  due_date             DATE NULL,
  status               ENUM('Not Started','In Progress','Partially Completed','Awaiting Input','On Hold','Completed') NOT NULL DEFAULT 'Not Started',
  remarks              VARCHAR(500) NULL,
  completed_at         DATETIME NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_project
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  CONSTRAINT fk_task_subdept
    FOREIGN KEY (sub_department_id) REFERENCES sub_departments(sub_department_id) ON DELETE RESTRICT,
  CONSTRAINT fk_task_employee
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE RESTRICT,
  KEY idx_tasks_project (project_id),
  KEY idx_tasks_employee (employee_id),
  KEY idx_tasks_subdept (sub_department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- time_logs — Start/Stop sessions. Completed hours are ALWAYS derived by
-- summing these — never stored as a static number on tasks/projects.
-- end_time and duration_minutes are NULL while a session is running.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS time_logs (
  log_id             INT AUTO_INCREMENT PRIMARY KEY,
  task_id             INT NOT NULL,
  employee_id         INT NOT NULL,
  start_time           DATETIME NOT NULL,
  end_time             DATETIME NULL,
  duration_minutes     INT NULL,
  log_date             DATE NOT NULL,
  -- Set when a session was left running past the maximum length and closed
  -- by the system; stays flagged until a manager reviews it.
  auto_stopped         TINYINT(1) NOT NULL DEFAULT 0,
  -- Manager correction trail: who changed the duration, when, and why.
  edited_by            INT NULL,
  edited_at            DATETIME NULL,
  note                 VARCHAR(500) NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_timelog_task
    FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  CONSTRAINT fk_timelog_employee
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
  CONSTRAINT fk_timelog_editor
    FOREIGN KEY (edited_by) REFERENCES employees(employee_id) ON DELETE SET NULL,
  KEY idx_timelogs_task (task_id),
  KEY idx_timelogs_employee (employee_id),
  KEY idx_timelogs_date (log_date),
  KEY idx_timelogs_review (auto_stopped, edited_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Enforce "one open session per employee at a time" at the application layer
-- (see src/controllers/timelogs.controller.js) — MySQL can't express a
-- partial-uniqueness constraint ("only one row where end_time IS NULL")
-- without a generated column trick, which isn't worth the complexity here.

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------
-- notifications — one row per recipient. dedupe_key makes an event idempotent
-- per recipient (e.g. "budget-80:12:640"), so a repeated trigger or a second
-- server sweep never creates a duplicate.
-- ---------------------------------------------------------------------------
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- correction_requests — an employee asks for a finished session to be credited
-- differently; the people who review that person's time approve or reject it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS correction_requests (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- audit_log — who changed what, and when (SRS §35). The actor's name and role
-- are copied into each row so the trail stays readable if they change later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- system_settings — values the System Administrator changes from the screen
-- (see src/services/settings.js for the list and the allowed ranges).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key    VARCHAR(60) NOT NULL PRIMARY KEY,
  setting_value  VARCHAR(100) NOT NULL,
  updated_by     INT NULL,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_setting_editor FOREIGN KEY (updated_by) REFERENCES employees(employee_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- schema_migrations — which scripts/migrations/*.js have been applied.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  name         VARCHAR(100) NOT NULL PRIMARY KEY,
  applied_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
