import React from 'react';
import StatusBadge from '../../components/common/StatusBadge';

const SEVERITY = { RED: 'red', AMBER: 'amber', GREEN: 'green' };

export default function RiskBadge({ risk }) {
  return <StatusBadge severity={SEVERITY[risk] || 'grey'}>{risk}</StatusBadge>;
}
