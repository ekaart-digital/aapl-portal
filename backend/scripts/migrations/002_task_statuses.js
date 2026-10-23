// SRS §16: a day's work can also end as Partially Completed or Awaiting Input.
// Both count as open work (anything other than Completed), so every existing
// "still open" rule keeps working.

exports.name = '002_task_statuses';

exports.up = async (pool) => {
  await pool.query(
    "ALTER TABLE tasks MODIFY status ENUM('Not Started','In Progress','Partially Completed','Awaiting Input','On Hold','Completed') NOT NULL DEFAULT 'Not Started'"
  );
};
