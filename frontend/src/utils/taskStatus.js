// The statuses a task can be in (SRS §16). Everything except Completed is open work.
export const TASK_STATUSES = ['Not Started', 'In Progress', 'Partially Completed', 'Awaiting Input', 'On Hold', 'Completed'];

// Which badge colour each status gets.
export function taskBadgeStatus(status) {
  switch (status) {
    case 'Completed': return 'Completed';
    case 'Not Started': return 'Pending';
    case 'In Progress': return 'Active';
    default: return status; // Partially Completed, Awaiting Input and On Hold have their own colours
  }
}
