// Shared test setup. Every test file runs in its own process (node --test),
// builds a fresh schema in a SEPARATE database and seeds small, known fixtures.
// It never touches the real application database.

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TEST_DB = 'aapl_platform_test';
process.env.DB_NAME = TEST_DB; // set before the app's pool is created
if (!process.env.LOGIN_RATE_LIMIT) process.env.LOGIN_RATE_LIMIT = '1000';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';

if (!process.env.DB_NAME.endsWith('_test')) {
  throw new Error('Refusing to run tests against a non-test database.');
}

const PASSWORD = 'Passw0rd!';
const TABLES = ['schema_migrations', 'system_settings', 'audit_log', 'correction_requests', 'notifications', 'time_logs', 'tasks', 'project_departments', 'projects', 'employees', 'sub_departments', 'teams', 'departments'];

function connectionOptions(withDatabase) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ...(withDatabase ? { database: TEST_DB } : {}),
    ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    multipleStatements: true,
  };
}

async function resetDatabase() {
  const admin = await mysql.createConnection(connectionOptions(false));
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\` CHARACTER SET utf8mb4`);
  await admin.end();

  const conn = await mysql.createConnection(connectionOptions(true));
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of TABLES) await conn.query(`DROP TABLE IF EXISTS ${table}`);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  await conn.query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  return conn;
}

// Fixture layout (ids are returned, never hard-coded in tests):
//   departments : Piping (Input Study, Analysis), Structural (Modelling)
//   project mgrs: manager1 (PM of project1 and project2), manager2
//   employees   : pipingA, pipingB (Piping), structA (Structural), inactive (Piping, inactive)
//   team leaders: tlPiping (leads pipingTeam: pipingA, pipingB), tlStruct (leads structTeam: structA)
//   dept heads  : headPiping, headStruct
//   others      : hr (HR/Admin), mgmt (Management), sysadmin (System Administrator)
//   project1    : Piping + Structural, estimate 100h
//   project2    : Piping only, estimate 50h
async function seedFixtures() {
  const conn = await resetDatabase();
  const hash = await bcrypt.hash(PASSWORD, 4);
  const f = {};

  async function insert(sql, params) {
    const [result] = await conn.query(sql, params);
    return result.insertId;
  }

  f.piping = await insert('INSERT INTO departments (name) VALUES (?)', ['Piping']);
  f.structural = await insert('INSERT INTO departments (name) VALUES (?)', ['Structural']);
  f.subInputStudy = await insert('INSERT INTO sub_departments (department_id, name) VALUES (?, ?)', [f.piping, 'Input Study']);
  f.subAnalysis = await insert('INSERT INTO sub_departments (department_id, name) VALUES (?, ?)', [f.piping, 'Analysis']);
  f.subModelling = await insert('INSERT INTO sub_departments (department_id, name) VALUES (?, ?)', [f.structural, 'Modelling']);

  const employee = (name, email, role, departmentId, status = 'active') => insert(
    `INSERT INTO employees (name, email, password_hash, department_id, designation, role, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, email, hash, departmentId, role === 'project_manager' ? 'Project Manager' : 'Engineer', role, status]
  );
  f.manager1 = await employee('Manager One', 'm1@test.local', 'project_manager', null);
  f.manager2 = await employee('Manager Two', 'm2@test.local', 'project_manager', null);
  f.pipingA = await employee('Piping A', 'pa@test.local', 'employee', f.piping);
  f.pipingB = await employee('Piping B', 'pb@test.local', 'employee', f.piping);
  f.structA = await employee('Structural A', 'sa@test.local', 'employee', f.structural);
  f.inactive = await employee('Inactive Person', 'in@test.local', 'employee', f.piping, 'inactive');

  // Organisation: teams with leaders, department heads, and the non-project roles.
  f.tlPiping = await employee('TL Piping', 'tlp@test.local', 'team_leader', f.piping);
  f.tlStruct = await employee('TL Structural', 'tls@test.local', 'team_leader', f.structural);
  f.headPiping = await employee('Head Piping', 'hp@test.local', 'department_head', f.piping);
  f.headStruct = await employee('Head Structural', 'hs@test.local', 'department_head', f.structural);
  f.hr = await employee('HR Admin', 'hr@test.local', 'hr_admin', null);
  f.mgmt = await employee('Management User', 'mg@test.local', 'management', null);
  f.sysadmin = await employee('System Admin', 'sys@test.local', 'system_admin', null);

  f.pipingTeam = await insert('INSERT INTO teams (name, department_id, leader_id) VALUES (?, ?, ?)', ['Piping Team', f.piping, f.tlPiping]);
  f.structTeam = await insert('INSERT INTO teams (name, department_id, leader_id) VALUES (?, ?, ?)', ['Structural Team', f.structural, f.tlStruct]);
  await conn.query('UPDATE employees SET team_id = ? WHERE employee_id IN (?, ?, ?)', [f.pipingTeam, f.pipingA, f.pipingB, f.tlPiping]);
  await conn.query('UPDATE employees SET team_id = ? WHERE employee_id IN (?, ?)', [f.structTeam, f.structA, f.tlStruct]);
  await conn.query('UPDATE departments SET head_id = ? WHERE department_id = ?', [f.headPiping, f.piping]);
  await conn.query('UPDATE departments SET head_id = ? WHERE department_id = ?', [f.headStruct, f.structural]);

  const project = (jobCode, name, estimate) => insert(
    `INSERT INTO projects (job_code, name, client_name, project_manager_id, estimated_man_hours, status)
     VALUES (?, ?, 'Test Client', ?, ?, 'In Progress')`,
    [jobCode, name, f.manager1, estimate]
  );
  f.project1 = await project('T-001', 'Project One', 100);
  f.project2 = await project('T-002', 'Project Two', 50);
  await conn.query('INSERT INTO project_departments (project_id, department_id) VALUES (?, ?), (?, ?), (?, ?)', [
    f.project1, f.piping, f.project1, f.structural, f.project2, f.piping,
  ]);

  f.addTask = (projectId, subDepartmentId, employeeId, taskName, allocatedHours = 10, status = 'Not Started') => insert(
    `INSERT INTO tasks (project_id, sub_department_id, employee_id, task_name, allocated_hours, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [projectId, subDepartmentId, employeeId, taskName, allocatedHours, status]
  );

  // A finished session of a known length, `daysAgo` days back.
  f.addLog = (taskId, employeeId, minutes, daysAgo = 1) => insert(
    `INSERT INTO time_logs (task_id, employee_id, start_time, end_time, duration_minutes, log_date)
     VALUES (?, ?, NOW() - INTERVAL ? DAY, NOW() - INTERVAL ? DAY + INTERVAL ? MINUTE, ?, CURDATE() - INTERVAL ? DAY)`,
    [taskId, employeeId, daysAgo, daysAgo, minutes, minutes, daysAgo]
  );

  f.addOpenLog = (taskId, employeeId) => insert(
    'INSERT INTO time_logs (task_id, employee_id, start_time, log_date) VALUES (?, ?, NOW(), CURDATE())',
    [taskId, employeeId]
  );

  f.db = conn;
  return f;
}

async function startApp() {
  const app = require('../src/app');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function api(urlPath, { method = 'GET', token, body } = {}) {
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, body: json, headers: res.headers };
  }

  async function login(employeeId, password = PASSWORD) {
    const res = await api('/auth/login', { method: 'POST', body: { employeeId, password } });
    if (res.status !== 200) throw new Error(`login(${employeeId}) failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.token;
  }

  async function close(fixtures) {
    await new Promise((resolve) => server.close(resolve));
    await require('../src/config/db').end();
    if (fixtures && fixtures.db) await fixtures.db.end();
  }

  return { api, login, close, base };
}

module.exports = { seedFixtures, startApp, resetDatabase, PASSWORD };
