import React from 'react';
import Tabs from '../common/Tabs';
import { shiftDate, todayStr } from '../../utils/dates';

const PERIODS = [
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
];

// Day / Week / Month, with previous and next buttons and a date to jump to.
// `date` is any day inside the period being shown.
export default function PeriodControls({ period, date, onChange }) {
  const today = todayStr();
  const move = (dir) => onChange({ period, date: shiftDate(date, period, dir) });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
      <Tabs items={PERIODS} active={period} onChange={(next) => onChange({ period: next, date })} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="btn btn-sm" onClick={() => move(-1)} aria-label={`Previous ${period}`}>‹</button>
        <input
          type="date"
          className="filter-input"
          aria-label="Date"
          value={date}
          max={today}
          onChange={(e) => { if (e.target.value) onChange({ period, date: e.target.value }); }}
        />
        <button className="btn btn-sm" onClick={() => move(1)} aria-label={`Next ${period}`}>›</button>
        <button className="btn btn-sm" onClick={() => onChange({ period, date: today })}>Today</button>
      </div>
    </div>
  );
}
