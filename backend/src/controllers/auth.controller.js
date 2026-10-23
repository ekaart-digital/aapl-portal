const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { assertStrongPassword } = require('../utils/password');
const { EMPLOYEE_SELECT, toSessionUser } = require('../services/people');
const { record } = require('../services/audit');

function signToken(employee) {
  return jwt.sign(
    { sub: employee.employee_id, role: employee.role, name: employee.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

// Accepts "EMP-004", "emp4", "004" or a bare number and pulls out the
// numeric employee_id — the login field displays as "EMP-004" but the
// underlying identifier is just the employees.employee_id primary key.
function parseEmployeeId(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  return Number(digits);
}

const login = asyncHandler(async (req, res) => {
  const { employeeId, password } = req.body;
  const id = parseEmployeeId(employeeId);
  if (!id || !password) throw ApiError.badRequest('Employee ID and password are required.');

  const [rows] = await pool.query(`${EMPLOYEE_SELECT} WHERE e.employee_id = ? LIMIT 1`, [id]);
  const employee = rows[0];
  if (!employee) throw ApiError.unauthorized('Invalid employee ID or password.');
  if (employee.status !== 'active') throw ApiError.forbidden('This account is inactive.');

  const passwordOk = await bcrypt.compare(password, employee.password_hash);
  const actor = { id: employee.employee_id, name: employee.name, role: employee.role };
  if (!passwordOk) {
    await record(actor, { action: 'auth.login-failed', entityType: 'auth', entityId: employee.employee_id, summary: `Failed sign-in for ${employee.name}` });
    throw ApiError.unauthorized('Invalid employee ID or password.');
  }

  await record(actor, { action: 'auth.login', entityType: 'auth', entityId: employee.employee_id, summary: `${employee.name} signed in` });
  res.json({ token: signToken(employee), user: toSessionUser(employee) });
});

const me = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`${EMPLOYEE_SELECT} WHERE e.employee_id = ? LIMIT 1`, [req.user.id]);
  if (!rows[0]) throw ApiError.notFound('Employee not found.');
  res.json({ user: toSessionUser(rows[0]) });
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) throw ApiError.badRequest('currentPassword and newPassword are required.');
  assertStrongPassword(newPassword, 'newPassword');

  const [rows] = await pool.query('SELECT password_hash FROM employees WHERE employee_id = ?', [req.user.id]);
  if (!rows[0]) throw ApiError.notFound('Employee not found.');
  if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    throw ApiError.badRequest('Current password is incorrect.');
  }

  await pool.query('UPDATE employees SET password_hash = ? WHERE employee_id = ?', [await bcrypt.hash(newPassword, 10), req.user.id]);
  await record(req.user, { action: 'auth.password-change', entityType: 'auth', entityId: req.user.id, summary: `${req.user.name} changed their password` });
  res.json({ ok: true });
});

module.exports = { login, me, changePassword };
