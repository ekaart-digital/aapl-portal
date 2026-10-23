import React from 'react';
import { severityToBadgeClass } from '../../utils/formatters';

const STATUS_MAP = {
  'On Time': 'green', 'Active': 'green', 'Online': 'green', 'Resolved': 'green', 'Completed': 'green', 'Connected': 'green',
  'Late': 'amber', 'Idle': 'amber', 'Idle — unexplained': 'red', 'Acknowledged': 'amber', 'Partially Completed': 'amber', 'Unstable': 'amber',
  'Very Late': 'red', 'Absent': 'red', 'Offline': 'red', 'Open': 'red', 'Pending': 'red', 'Disconnected': 'red',
  'Leave': 'grey', 'On Approved Leave': 'grey', 'Awaiting Input': 'grey', 'On Hold': 'grey',
  'Away': 'blue', 'Client Meeting': 'blue', 'Site Visit': 'blue',
};

export default function StatusBadge({ status, severity, children }) {
  const s = severity || STATUS_MAP[status] || 'grey';
  return <span className={`badge ${severityToBadgeClass(s)}`}>{children || status}</span>;
}
