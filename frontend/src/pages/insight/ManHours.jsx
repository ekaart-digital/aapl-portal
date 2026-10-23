import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/layout/PageHeader';
import DataTable from '../../components/common/DataTable';
import ProgressBar from '../../components/common/ProgressBar';
import StatusBadge from '../../components/common/StatusBadge';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import RiskBadge from './RiskBadge';
import * as dashboardApi from '../../api/dashboard';
import { exportToExcel, exportToCsv } from '../../utils/exportReport';
import { useApp } from '../../context/AppContext';

const barColor = (pct) => (pct >= 100 ? 'red' : pct >= 80 ? 'amber' : 'green');

const EXPORT_COLUMNS = [
  { header: 'Job Code', value: (r) => r.jobCode },
  { header: 'Project', value: (r) => r.name },
  { header: 'Project Manager', value: (r) => r.projectManagerName },
  { header: 'Status', value: (r) => r.status },
  { header: 'Estimated MH', value: (r) => r.estimatedManHours },
  { header: 'Consumed MH', value: (r) => r.consumedManHours },
  { header: 'Remaining MH', value: (r) => r.remainingManHours },
  { header: 'Consumed %', value: (r) => r.consumedPercent },
  { header: 'Completion %', value: (r) => r.completionPercent },
  { header: 'Projected Final MH', value: (r) => r.projectedFinalManHours ?? '' },
  { header: 'Risk', value: (r) => r.risk },
];

function BreakdownTable({ title, rows }) {
  return (
    <div>
      <div className="section-title">{title}</div>
      {rows.length === 0 ? <div className="muted" style={{ fontSize: 12.5 }}>No hours logged yet.</div> : rows.map((r) => (
        <div className="detail-row" key={r.id}>
          <span>{r.name}</span>
          <span className="mono" style={{ fontWeight: 600 }}>{r.hours}h</span>
        </div>
      ))}
    </div>
  );
}

// The Project Man-Hour dashboard (SRS §26).
export default function ManHours() {
  const { pushToast } = useApp();
  const [projects, setProjects] = useState([]);
  const [risk, setRisk] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setProjects(await dashboardApi.listProjectHealth());
    } catch (err) {
      setError(err.message || 'Failed to load man-hours.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function select(row) {
    setSelectedId(row.id);
    setDetail(null);
    try {
      setDetail(await dashboardApi.getProjectManHours(row.id));
    } catch (err) {
      pushToast(err.message || 'Could not load the breakdown.');
    }
  }

  const rows = useMemo(() => projects.filter((p) => !risk || p.risk === risk), [projects, risk]);
  const counts = useMemo(() => projects.reduce((acc, p) => ({ ...acc, [p.risk]: (acc[p.risk] || 0) + 1 }), {}), [projects]);

  const columns = [
    {
      key: 'name',
      header: 'Project',
      render: (r) => (
        <>
          <div className="cell-primary">{r.name}</div>
          <div className="cell-sub">{r.jobCode} · {r.projectManagerName}</div>
        </>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status === 'Completed' ? 'Completed' : r.status === 'On Hold' ? 'On Hold' : 'Active'}>{r.status}</StatusBadge> },
    { key: 'estimate', header: 'Budget MH', className: 'mono', render: (r) => r.estimatedManHours },
    { key: 'consumed', header: 'Consumed', className: 'mono', render: (r) => r.consumedManHours },
    { key: 'remaining', header: 'Remaining', className: 'mono', render: (r) => r.remainingManHours },
    {
      key: 'used',
      header: 'Budget used',
      width: 140,
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 70 }}><ProgressBar pct={r.consumedPercent} color={barColor(r.consumedPercent)} /></div>
          <span className="mono" style={{ fontSize: 11.5 }}>{r.consumedPercent}%</span>
        </div>
      ),
    },
    {
      key: 'completion',
      header: 'Work done',
      width: 140,
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 70 }}><ProgressBar pct={r.completionPercent} color="accent" /></div>
          <span className="mono" style={{ fontSize: 11.5 }}>{r.completionPercent}%</span>
        </div>
      ),
    },
    { key: 'projected', header: 'Projected final', className: 'mono', render: (r) => (r.projectedFinalManHours != null ? r.projectedFinalManHours : '—') },
    { key: 'risk', header: 'Risk', render: (r) => <RiskBadge risk={r.risk} /> },
  ];

  if (loading) return <Loading label="Loading man-hours…" />;
  if (error) {
    return <EmptyState icon="AlertTriangle" title="Couldn't load man-hours" sub={error} action={<button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button>} />;
  }

  return (
    <>
      <PageHeader
        title="Project Man-Hours"
        sub="Budget, hours used and where each project is heading"
        actions={<>
          <button className="btn" onClick={() => exportToCsv({ fileName: 'project-man-hours', columns: EXPORT_COLUMNS, rows }).catch((err) => pushToast(err.message || 'Export failed.'))} disabled={!rows.length}>Export CSV</button>
          <button className="btn" onClick={() => exportToExcel({ fileName: 'project-man-hours', columns: EXPORT_COLUMNS, rows })} disabled={!rows.length}>Export Excel</button>
        </>}
      />

      <div className="filter-bar">
        <select className="filter-select" aria-label="Risk" value={risk} onChange={(e) => setRisk(e.target.value)}>
          <option value="">All risk levels</option>
          <option value="RED">Red ({counts.RED || 0})</option>
          <option value="AMBER">Amber ({counts.AMBER || 0})</option>
          <option value="GREEN">Green ({counts.GREEN || 0})</option>
        </select>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <DataTable columns={columns} rows={rows} onRowClick={select} emptyTitle="No projects" emptySub="No projects match this filter." />
      </div>

      {selectedId && (
        <div className="card" data-testid="manhour-breakdown">
          <div className="card-head">
            <div>
              <h3>{detail ? detail.name : 'Loading breakdown…'}</h3>
              <div className="card-head-sub">Hours logged by person, task type and department</div>
            </div>
            {detail && <Link className="btn btn-sm" to={`/projects/${detail.id}`}>Open project</Link>}
          </div>
          <div className="card-pad">
            {!detail ? <Loading label="Loading breakdown…" /> : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24 }}>
                <BreakdownTable title="By employee" rows={detail.byEmployee} />
                <BreakdownTable title="By task type" rows={detail.byTaskType} />
                <BreakdownTable title="By category" rows={detail.byCategory || []} />
                <BreakdownTable title="By department" rows={detail.byDepartment} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
