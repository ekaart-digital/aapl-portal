const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { ENTITY_TYPES, AUDIT_ACCESS } = require('../services/audit');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PAGE = 200;

// Treat % and _ in what the user typed as plain characters, not wildcards.
const escapeLike = (text) => String(text).replace(/[\\%_]/g, (c) => `\\${c}`);

function parseDetails(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

// GET /api/audit — filters: entityType, action (prefix, e.g. "employee."),
// actorId, q (text in the summary), from, to (dates), limit, offset.
// What comes back is limited to the entity types the caller's role may read.
const listAudit = asyncHandler(async (req, res) => {
  const { entityType, action, actorId, q, from, to } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), MAX_PAGE);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) throw ApiError.badRequest('from and to must be dates in YYYY-MM-DD format.');
  if (entityType && !ENTITY_TYPES.includes(entityType)) throw ApiError.badRequest('Unknown entityType.');
  if (actorId && !/^\d+$/.test(String(actorId))) throw ApiError.badRequest('actorId must be a number.');

  const allowed = AUDIT_ACCESS[req.user.role]; // null = everything
  const readable = allowed || ENTITY_TYPES;

  const where = [];
  const params = [];
  if (allowed) { where.push('entity_type IN (?)'); params.push(allowed); }
  if (entityType) { where.push('entity_type = ?'); params.push(entityType); }
  if (action) { where.push("action LIKE ? ESCAPE '\\\\'"); params.push(`${escapeLike(action)}%`); }
  if (actorId) { where.push('actor_id = ?'); params.push(Number(actorId)); }
  if (q) { where.push("summary LIKE ? ESCAPE '\\\\'"); params.push(`%${escapeLike(q)}%`); }
  if (from) { where.push('created_at >= ?'); params.push(`${from} 00:00:00`); }
  if (to) { where.push('created_at < ? + INTERVAL 1 DAY'); params.push(to); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_log ${clause}`, params);
  const [rows] = await pool.query(
    `SELECT * FROM audit_log ${clause} ORDER BY audit_id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({
    total: Number(total),
    entityTypes: readable,
    entries: rows.map((r) => ({
      id: Number(r.audit_id),
      at: r.created_at,
      actorId: r.actor_id,
      actorName: r.actor_name,
      actorRole: r.actor_role,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      summary: r.summary,
      details: parseDetails(r.details),
    })),
  });
});

module.exports = { listAudit };
