import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/layout/PageHeader';
import StatusBadge from '../../components/common/StatusBadge';
import DataTable from '../../components/common/DataTable';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import * as dashboardApi from '../../api/dashboard';
import { exportToCsv } from '../../utils/exportReport';
import { useApp } from '../../context/AppContext';

const TYPES = [
  ['task-overdue', 'Overdue tasks'],
  ['task-over-allocation', 'Over allocation'],
  ['task-awaiting-input', 'Awaiting input'],
  ['task-on-hold', 'On hold'],
  ['no-allocation', 'No allocation'],
  ['budget-exceeded', 'Man-hours used up'],
  ['budget-warning', 'Man-hours nearly used'],
  ['projected-overrun', 'Projected overrun'],
  ['project-overdue', 'Past target date'],
  ['session-review', 'Time review'],
];

const SEVERITY_BADGE = { critical: 'red', attention: 'amber' };

const EXPORT_COLUMNS = [
  { header: 'Severity', value: (r) => r.severity },
  { header: 'Type', value: (r) => r.category },
  { header: 'Exception', value: (r) => r.title },
  { header: 'Detail', value: (r) => r.detail },
  { header: 'Project', value: (r) => r.projectName },
];

// The exception screen (SRS §30): what needs attention across the projects the
// user can see, most urgent first.
export default function Exceptions() {
  const { pushToast } = useApp();
  const [items, setItems] = useState([]);
  const [severity, setSeverity] = useState('');
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setItems(await dashboardApi.listExceptions({ severity, type }));
    } catch (err) {
      setError(err.message || 'Failed to load exceptions.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [severity, type]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = [
    { key: 'severity', header: 'Severity', width: 110, render: (r) => <StatusBadge severity={SEVERITY_BADGE[r.severity]}>{r.severity === 'critical' ? 'Critical' : 'Attention'}</StatusBadge> },
    { key: 'category', header: 'Type', width: 150, render: (r) => r.category },
    {
      key: 'title',
      header: 'Exception',
      render: (r) => (
        <>
          <div className="cell-primary">{r.title}</div>
          <div className="cell-sub">{r.detail}</div>
        </>
      ),
    },
    { key: 'projectName', header: 'Project', render: (r) => (r.projectId ? <Link className="link-btn" to={`/projects/${r.projectId}`}>{r.projectName}</Link> : <span className="muted">—</span>) },
  ];

  return (
    <>
      <PageHeader
        title="Exceptions"
        sub="Overdue work, tasks waiting on input, man-hour overruns, people with no work and time awaiting review"
        actions={<button className="btn" onClick={() => exportToCsv({ fileName: 'exceptions', columns: EXPORT_COLUMNS, rows: items }).catch((err) => pushToast(err.message || 'Export failed.'))} disabled={!items.length}>Export CSV</button>}
      />

      <div className="filter-bar">
        <select className="filter-select" aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="attention">Attention</option>
        </select>
        <select className="filter-select" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div className="card">
        {loading ? <Loading label="Loading exceptions…" /> : error ? (
          <EmptyState icon="AlertTriangle" title="Couldn't load exceptions" sub={error} action={<button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button>} />
        ) : (
          <DataTable columns={columns} rows={items} emptyTitle="Nothing needs attention" emptySub="No exceptions match these filters." />
        )}
      </div>
    </>
  );
}
