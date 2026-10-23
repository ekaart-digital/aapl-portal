const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { assertStrongPassword } = require('../utils/password');
const { record, changes } = require('../services/audit');
const { EMPLOYEE_SELECT, toPublicEmployee } = require('../services/people');
const {
  ROLES, ALL_ROLES, ROLE_LABELS, NO_DEPARTMENT_ROLES, HR_ASSIGNABLE_ROLES, PROJECT_MANAGER_ROLES, TASK_HOLDER_ROLES, can,
} = require('../auth/permissions');
const { employeeScope } = require('../auth/scope');

const MAX_PHOTO_CHARS = 250000; // roughly a 180 KB image
const PHOTO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Highest-privilege accounts only a System Administrator may touch.
const PROTECTED_ROLES = [ROLES.HR_ADMIN, ROLES.MANAGEMENT, ROLES.SYSTEM_ADMIN];

const ROLE_ORDER = "FIELD(e.role, 'management','system_admin','hr_admin','department_head','project_manager','team_leader','employee')";

async function fetchEmployee(id) {
  const [rows] = await pool.query(`${EMPLOYEE_SELECT} WHERE e.employee_id = ?`, [id]);
  return rows[0] || null;
}

const listEmployees = asyncHandler(async (req, res) => {
  const scope = employeeScope(req.user, 'e');
  const [rows] = await pool.query(
    `${EMPLOYEE_SELECT} WHERE ${scope.sql} ORDER BY ${ROLE_ORDER}, e.name`,
    scope.params
  );
  const showProjects = can(req.user.role, 'projects.view');
  res.json({ employees: rows.map((r) => toPublicEmployee(r, showProjects)) });
});

const getEmployee = asyncHandler(async (req, res) => {
  const scope = employeeScope(req.user, 'e');
  const [rows] = await pool.query(`${EMPLOYEE_SELECT} WHERE e.employee_id = ? AND ${scope.sql}`, [req.params.id, ...scope.params]);
  if (rows[0]) return res.json({ employee: toPublicEmployee(rows[0], can(req.user.role, 'projects.view')) });

  const exists = await fetchEmployee(req.params.id);
  throw exists ? ApiError.forbidden('You cannot view this person.') : ApiError.notFound('Employee not found.');
});

function assertActorMayManageRole(actor, role) {
  if (actor.role === ROLES.SYSTEM_ADMIN) return;
  if (!HR_ASSIGNABLE_ROLES.includes(role)) {
    throw ApiError.forbidden(`Only a System Administrator can manage ${ROLE_LABELS[role]} accounts.`);
  }
}

// Validates a department/team pair for a role and returns what to store.
async function resolveOrganisation({ role, departmentId, teamId, teamGiven }) {
  if (NO_DEPARTMENT_ROLES.includes(role)) return { departmentId: null, teamId: null };

  if (!departmentId) throw ApiError.badRequest(`departmentId is required for ${ROLE_LABELS[role]}.`);
  const [dept] = await pool.query('SELECT department_id FROM departments WHERE department_id = ?', [departmentId]);
  if (!dept.length) throw ApiError.badRequest('That department does not exist.');

  if (!TASK_HOLDER_ROLES.includes(role)) return { departmentId: Number(departmentId), teamId: null };
  if (teamId == null) return { departmentId: Number(departmentId), teamId: teamGiven ? null : undefined };

  const [team] = await pool.query('SELECT department_id FROM teams WHERE team_id = ?', [teamId]);
  if (!team.length) throw ApiError.badRequest('That team does not exist.');
  if (team[0].department_id !== Number(departmentId)) throw ApiError.badRequest('That team belongs to a different department.');
  return { departmentId: Number(departmentId), teamId: Number(teamId) };
}

function assertOptionalFields({ email, dateOfJoining, mobileNumber }) {
  if (email !== undefined && !EMAIL_RE.test(String(email))) throw ApiError.badRequest('email must be a valid email address.');
  if (dateOfJoining != null && dateOfJoining !== '' && !DATE_RE.test(String(dateOfJoining))) {
    throw ApiError.badRequest('dateOfJoining must be a date in YYYY-MM-DD format.');
  }
  if (mobileNumber != null && mobileNumber !== '' && !/^[0-9+()\-\s]{5,30}$/.test(String(mobileNumber))) {
    throw ApiError.badRequest('mobileNumber must be a phone number.');
  }
}

const createEmployee = asyncHandler(async (req, res) => {
  const { name, email, password, role, departmentId, teamId, designation, dateOfJoining, mobileNumber, overtimeEligible } = req.body;
  if (!name || !email || !password || !role) throw ApiError.badRequest('name, email, password and role are required.');
  if (!ALL_ROLES.includes(role)) throw ApiError.badRequest(`role must be one of: ${ALL_ROLES.join(', ')}.`);
  assertActorMayManageRole(req.user, role);
  assertOptionalFields({ email, dateOfJoining, mobileNumber });
  assertStrongPassword(password);

  const org = await resolveOrganisation({ role, departmentId, teamId, teamGiven: teamId != null });

  const [existing] = await pool.query('SELECT employee_id FROM employees WHERE email = ?', [email]);
  if (existing.length) throw ApiError.conflict('An employee with this email already exists.');

  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    `INSERT INTO employees (name, email, password_hash, department_id, team_id, designation, role, status, date_of_joining, mobile_number, overtime_eligible)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [name, email, passwordHash, org.departmentId, org.teamId ?? null, designation || null, role, dateOfJoining || null, mobileNumber || null, overtimeEligible ? 1 : 0]
  );

  const created = await fetchEmployee(result.insertId);
  await record(req.user, {
    action: 'employee.create',
    entityType: 'employee',
    entityId: result.insertId,
    summary: `Created ${ROLE_LABELS[role]} account for ${name}`,
    details: { role, departmentId: org.departmentId, teamId: org.teamId ?? null, email },
  });
  res.status(201).json({ employee: toPublicEmployee(created, can(req.user.role, 'projects.view')) });
});

// An account must never leave the system with nobody able to administer it.
async function assertNotLastSystemAdmin(targetId) {
  const [rows] = await pool.query("SELECT employee_id FROM employees WHERE role = 'system_admin' AND status = 'active' AND employee_id <> ?", [targetId]);
  if (!rows.length) throw ApiError.conflict('This is the only active System Administrator. Create another one first.');
}

const updateEmployee = asyncHandler(async (req, res) => {
  const body = req.body;
  const target = await fetchEmployee(req.params.id);
  if (!target) throw ApiError.notFound('Employee not found.');
  const isSelf = target.employee_id === req.user.id;

  // HR/Admin works on operational accounts; the powerful ones are the System Administrator's.
  if (req.user.role !== ROLES.SYSTEM_ADMIN && PROTECTED_ROLES.includes(target.role)) {
    throw ApiError.forbidden(`Only a System Administrator can change ${ROLE_LABELS[target.role]} accounts.`);
  }

  if (body.status !== undefined && !['active', 'inactive'].includes(body.status)) {
    throw ApiError.badRequest("status must be 'active' or 'inactive'.");
  }
  if (body.status === 'inactive' && isSelf) throw ApiError.badRequest('You cannot deactivate your own account.');
  if (body.name !== undefined && !String(body.name).trim()) throw ApiError.badRequest('name cannot be empty.');
  assertOptionalFields(body);

  let newRole = target.role;
  if (body.role !== undefined && body.role !== target.role) {
    if (!can(req.user.role, 'roles.assign')) throw ApiError.forbidden('Only a System Administrator can change roles.');
    if (!ALL_ROLES.includes(body.role)) throw ApiError.badRequest(`role must be one of: ${ALL_ROLES.join(', ')}.`);
    if (isSelf) throw ApiError.badRequest('You cannot change your own role.');
    newRole = body.role;
  }
  const newStatus = body.status || target.status;

  if (target.role === ROLES.SYSTEM_ADMIN && (newRole !== ROLES.SYSTEM_ADMIN || newStatus !== 'active')) {
    await assertNotLastSystemAdmin(target.employee_id);
  }

  if (body.email !== undefined && body.email !== target.email) {
    const [dupe] = await pool.query('SELECT employee_id FROM employees WHERE email = ? AND employee_id <> ?', [body.email, req.params.id]);
    if (dupe.length) throw ApiError.conflict('An employee with this email already exists.');
  }

  // Organisation: recompute whenever role, department or team is touched.
  const touchesOrg = newRole !== target.role || has(body, 'departmentId') || has(body, 'teamId');
  let org = { departmentId: target.department_id, teamId: target.team_id };
  if (touchesOrg) {
    const wantedDept = has(body, 'departmentId') ? body.departmentId : target.department_id;
    const keepTeam = !has(body, 'departmentId') || Number(wantedDept) === target.department_id;
    const wantedTeam = has(body, 'teamId') ? body.teamId : (keepTeam ? target.team_id : null);
    org = await resolveOrganisation({ role: newRole, departmentId: wantedDept, teamId: wantedTeam, teamGiven: true });
    if (org.teamId === undefined) org.teamId = null;
  }

  // Guard rails that protect work already in flight.
  const leavingDepartment = org.departmentId !== target.department_id && target.department_id != null;
  const stopsHoldingTasks = TASK_HOLDER_ROLES.includes(target.role) && !TASK_HOLDER_ROLES.includes(newRole);
  const beingDeactivated = newStatus === 'inactive' && target.status === 'active';
  if (leavingDepartment || stopsHoldingTasks || beingDeactivated) {
    const [open] = await pool.query("SELECT COUNT(*) AS n FROM tasks WHERE employee_id = ? AND status <> 'Completed'", [target.employee_id]);
    if (Number(open[0].n) > 0) {
      throw ApiError.conflict(`${target.name} still has ${open[0].n} open task(s). Reassign them first.`);
    }
  }
  const stopsBeingProjectManager = (!PROJECT_MANAGER_ROLES.includes(newRole) || newStatus === 'inactive')
    && PROJECT_MANAGER_ROLES.includes(target.role);
  if (stopsBeingProjectManager) {
    const [managed] = await pool.query("SELECT COUNT(*) AS n FROM projects WHERE project_manager_id = ? AND status <> 'Completed'", [target.employee_id]);
    if (Number(managed[0].n) > 0) {
      throw ApiError.conflict(`${target.name} is the project manager of ${managed[0].n} active project(s). Hand them over first.`);
    }
  }

  const sets = [];
  const params = [];
  const set = (column, value) => { sets.push(`${column} = ?`); params.push(value); };
  if (body.name !== undefined) set('name', String(body.name).trim());
  if (body.email !== undefined) set('email', body.email);
  if (has(body, 'designation')) set('designation', body.designation || null);
  if (has(body, 'dateOfJoining')) set('date_of_joining', body.dateOfJoining || null);
  if (has(body, 'mobileNumber')) set('mobile_number', body.mobileNumber || null);
  if (has(body, 'overtimeEligible')) set('overtime_eligible', body.overtimeEligible ? 1 : 0);
  if (body.status !== undefined) set('status', body.status);
  if (newRole !== target.role) set('role', newRole);
  if (touchesOrg) { set('department_id', org.departmentId); set('team_id', org.teamId); }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (sets.length) await conn.query(`UPDATE employees SET ${sets.join(', ')} WHERE employee_id = ?`, [...params, target.employee_id]);

    // Someone who is deactivated, or whose role no longer fits, stops leading.
    const roleChanged = newRole !== target.role;
    if (newStatus === 'inactive' || (roleChanged && newRole !== ROLES.TEAM_LEADER)) {
      await conn.query('UPDATE teams SET leader_id = NULL WHERE leader_id = ?', [target.employee_id]);
    }
    if (newStatus === 'inactive' || (roleChanged && newRole !== ROLES.DEPARTMENT_HEAD)) {
      await conn.query('UPDATE departments SET head_id = NULL WHERE head_id = ?', [target.employee_id]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const after = await fetchEmployee(target.employee_id);
  const diff = changes(target, after, ['name', 'email', 'designation', 'date_of_joining', 'mobile_number', 'overtime_eligible', 'status', 'role', 'department_id', 'team_id']);
  if (Object.keys(diff).length) {
    const entity = { entityType: 'employee', entityId: target.employee_id };
    await record(req.user, { ...entity, action: 'employee.update', summary: `Updated ${after.name}: ${Object.keys(diff).join(', ')}`, details: diff });
    if (diff.role) {
      await record(req.user, { ...entity, action: 'employee.role-change', summary: `Changed ${after.name} from ${ROLE_LABELS[target.role]} to ${ROLE_LABELS[after.role]}`, details: diff.role });
    }
    if (diff.status) {
      await record(req.user, { ...entity, action: after.status === 'inactive' ? 'employee.deactivate' : 'employee.activate', summary: `${after.status === 'inactive' ? 'Deactivated' : 'Reactivated'} ${after.name}`, details: diff.status });
    }
  }
  res.json({ employee: toPublicEmployee(after, can(req.user.role, 'projects.view')) });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  assertStrongPassword(password);

  const [existing] = await pool.query('SELECT employee_id, name, role FROM employees WHERE employee_id = ?', [req.params.id]);
  if (!existing.length) throw ApiError.notFound('Employee not found.');
  if (req.user.role !== ROLES.SYSTEM_ADMIN && PROTECTED_ROLES.includes(existing[0].role)) {
    throw ApiError.forbidden(`Only a System Administrator can reset the password of a ${ROLE_LABELS[existing[0].role]}.`);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE employees SET password_hash = ? WHERE employee_id = ?', [passwordHash, req.params.id]);
  await record(req.user, { action: 'employee.password-reset', entityType: 'employee', entityId: existing[0].employee_id, summary: `Reset the password of ${existing[0].name}` });
  res.json({ ok: true });
});

// The photograph is kept out of the lists (it is large) and fetched on its own.
const getPhoto = asyncHandler(async (req, res) => {
  const scope = employeeScope(req.user, 'e');
  const [rows] = await pool.query(`SELECT e.photo FROM employees e WHERE e.employee_id = ? AND ${scope.sql}`, [req.params.id, ...scope.params]);
  if (!rows.length) throw ApiError.notFound('Employee not found.');
  res.json({ photo: rows[0].photo || null });
});

const setPhoto = asyncHandler(async (req, res) => {
  const target = await fetchEmployee(req.params.id);
  if (!target) throw ApiError.notFound('Employee not found.');
  if (req.user.role !== ROLES.SYSTEM_ADMIN && PROTECTED_ROLES.includes(target.role)) {
    throw ApiError.forbidden(`Only a System Administrator can change the photograph of a ${ROLE_LABELS[target.role]}.`);
  }
  const { photo } = req.body;
  if (photo !== null) {
    if (typeof photo !== 'string' || !PHOTO_RE.test(photo)) throw ApiError.badRequest('photo must be a PNG, JPEG or WebP image sent as a data URL, or null to remove it.');
    if (photo.length > MAX_PHOTO_CHARS) throw ApiError.badRequest('That photograph is too large. Use an image under about 180 KB.');
  }
  await pool.query('UPDATE employees SET photo = ? WHERE employee_id = ?', [photo, target.employee_id]);
  await record(req.user, {
    action: 'employee.photo',
    entityType: 'employee',
    entityId: target.employee_id,
    summary: `${photo ? 'Set' : 'Removed'} the photograph of ${target.name}`,
  });
  res.json({ ok: true });
});

module.exports = { listEmployees, getEmployee, createEmployee, updateEmployee, resetPassword, getPhoto, setPhoto };
