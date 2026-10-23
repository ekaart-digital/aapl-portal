const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function toPublic(row) {
  return {
    id: row.notification_id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    body: row.body,
    link: row.link,
    read: Boolean(row.is_read),
    // Age is measured by the database clock so clients never have to
    // interpret a timezone-less DATETIME.
    ageSeconds: Number(row.age_seconds),
  };
}

async function unreadCountFor(employeeId) {
  const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND is_read = 0', [employeeId]);
  return Number(row.n);
}

// Newest first. `before` is the id of the last item already shown (keyset
// paging), `unread=1` filters to unread only.
const listNotifications = asyncHandler(async (req, res) => {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(req.query.limit, 10) || DEFAULT_LIMIT));
  const params = [req.user.id];
  let where = 'recipient_id = ?';

  if (req.query.unread === '1') where += ' AND is_read = 0';
  if (req.query.before !== undefined) {
    if (!/^\d+$/.test(String(req.query.before))) throw ApiError.badRequest('before must be a notification ID.');
    where += ' AND notification_id < ?';
    params.push(Number(req.query.before));
  }

  const [rows] = await pool.query(
    `SELECT *, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_seconds
       FROM notifications WHERE ${where}
      ORDER BY notification_id DESC LIMIT ?`,
    [...params, limit + 1]
  );

  res.json({
    notifications: rows.slice(0, limit).map(toPublic),
    hasMore: rows.length > limit,
    unreadCount: await unreadCountFor(req.user.id),
  });
});

const unreadCount = asyncHandler(async (req, res) => {
  res.json({ unreadCount: await unreadCountFor(req.user.id) });
});

// You can only ever touch your own notifications; someone else's is a 404.
const markRead = asyncHandler(async (req, res) => {
  const [result] = await pool.query(
    'UPDATE notifications SET is_read = 1, read_at = COALESCE(read_at, NOW()) WHERE notification_id = ? AND recipient_id = ?',
    [req.params.id, req.user.id]
  );
  if (!result.affectedRows) {
    const [exists] = await pool.query('SELECT 1 FROM notifications WHERE notification_id = ? AND recipient_id = ?', [req.params.id, req.user.id]);
    if (!exists.length) throw ApiError.notFound('Notification not found.');
  }
  res.json({ unreadCount: await unreadCountFor(req.user.id) });
});

const markAllRead = asyncHandler(async (req, res) => {
  await pool.query(
    'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE recipient_id = ? AND is_read = 0',
    [req.user.id]
  );
  res.json({ unreadCount: 0 });
});

module.exports = { listNotifications, unreadCount, markRead, markAllRead };
