const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { ROLES, can } = require('../auth/permissions');
const { isRoleEnabled } = require('../config/rollout');

// Everything a request needs to know about who is calling, read fresh from
// the database so a deactivation or role change applies immediately.
async function loadUserContext(employeeId) {
  const [rows] = await pool.query(
    'SELECT employee_id, name, role, status, department_id, team_id FROM employees WHERE employee_id = ?',
    [employeeId]
  );
  const e = rows[0];
  if (!e || e.status !== 'active') return null;

  const user = {
    id: e.employee_id,
    role: e.role,
    name: e.name,
    departmentId: e.department_id,
    teamId: e.team_id,
    scopeDepartmentIds: [],
    teamIds: [],
  };

  if (e.role === ROLES.DEPARTMENT_HEAD) {
    const [headed] = await pool.query('SELECT department_id FROM departments WHERE head_id = ?', [e.employee_id]);
    user.scopeDepartmentIds = [...new Set([...headed.map((d) => d.department_id), ...(e.department_id ? [e.department_id] : [])])];
  } else if (e.role === ROLES.TEAM_LEADER) {
    const [led] = await pool.query('SELECT team_id, department_id FROM teams WHERE leader_id = ?', [e.employee_id]);
    user.teamIds = led.map((t) => t.team_id);
    user.scopeDepartmentIds = [...new Set([...led.map((t) => t.department_id), ...(e.department_id ? [e.department_id] : [])])];
  }
  return user;
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(ApiError.unauthorized('Missing bearer token'));

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return next(ApiError.unauthorized('Invalid or expired token'));
  }

  try {
    const user = await loadUserContext(payload.sub);
    if (!user) return next(ApiError.unauthorized('This account is no longer active.'));
    if (!isRoleEnabled(user.role)) return next(ApiError.forbidden('Your role is not available yet.'));
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

// requireRole('project_manager', 'management') — call after requireAuth
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowedRoles.includes(req.user.role)) {
      return next(ApiError.forbidden(`This action requires role: ${allowedRoles.join(' or ')}`));
    }
    next();
  };
}

// requireCapability('projects.create') — call after requireAuth
function requireCapability(capability) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!can(req.user.role, capability)) {
      return next(ApiError.forbidden('Your role does not allow this action.'));
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requireCapability, loadUserContext };
