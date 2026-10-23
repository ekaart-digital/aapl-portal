import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/layout/PageHeader';
import StatCard from '../../components/common/StatCard';
import StatusBadge from '../../components/common/StatusBadge';
import DataTable from '../../components/common/DataTable';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import RiskBadge from './RiskBadge';
import * as dashboardApi from '../../api/dashboard';
import { TASK_STATUSES, taskBadgeStatus } from '../../utils/taskStatus';

const TITLES = { team: 'Team Dashboard', department: 'Department Dashboard', company: 'Company Dashboard' };

// One dashboard for three roles (SRS §25): the server decides whether it shows
// the user's team, their department(s) or the whole company.
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      setData(await dashboardApi.getOverview());
    } catch (err) {
      setError(err.message || 'Failed to load the dashboard.');
    }
  }

  useEffect(() => { load(); }, []);

  if (error) {
    return <EmptyState icon="AlertTriangle" title="Couldn't load the dashboard" sub={error} action={<button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button>} />;
  }
  if (!data) return <Loading label="Loading the dashboard…" />;

  const { stats, statusCounts, people, projects, exceptions } = data;

  const peopleColumns = [
    {
      key: 'name',
      header: 'Person',
      render: (r) => (
        <>
          <div className="cell-primary">{r.name}{r.isTeamLeader ? ' · Team Leader' : ''}</div>
          <div className="cell-sub">{[r.designation, data.kind !== 'team' ? r.team : null].filter(Boolean).join(' · ')}</div>
        </>
      ),
    },
    ...(data.kind === 'company' ? [{ key: 'department', header: 'Department', render: (r) => r.department || '—' }] : []),
    { key: 'openTasks', header: 'Open tasks', className: 'mono', render: (r) => (r.openTasks ? r.openTasks : <StatusBadge severity="amber">None</StatusBadge>) },
    { key: 'overdueTasks', header: 'Overdue', className: 'mono', render: (r) => (r.overdueTasks ? <StatusBadge severity="red">{r.overdueTasks}</StatusBadge> : 0) },
    { key: 'blockedTasks', header: 'Waiting / on hold', className: 'mono', render: (r) => (r.blockedTasks ? <StatusBadge severity="amber">{r.blockedTasks}</StatusBadge> : 0) },
    { key: 'hoursToday', header: 'Today', className: 'mono', render: (r) => `${r.hoursToday}h` },
    { key: 'hoursWeek', header: 'This week', className: 'mono', render: (r) => `${r.hoursWeek}h` },
    { key: 'runningTask', header: 'Working on', render: (r) => (r.runningTask ? <StatusBadge severity="green">{r.runningTask}</StatusBadge> : <span className="muted">—</span>) },
  ];

  const projectColumns = [
    { key: 'name', header: 'Project', render: (r) => <><div className="cell-primary">{r.name}</div><div className="cell-sub">{r.jobCode}</div></> },
    { key: 'consumed', header: 'Used / budget', className: 'mono', render: (r) => `${r.consumedManHours} / ${r.estimatedManHours}h` },
    { key: 'completion', header: 'Work done', className: 'mono', render: (r) => `${r.completionPercent}%` },
    { key: 'risk', header: 'Risk', render: (r) => <RiskBadge risk={r.risk} /> },
  ];

  return (
    <>
      <PageHeader title={TITLES[data.kind] || 'Dashboard'} sub={data.scopeLabel} />

      <div className="stat-grid">
        <StatCard label="People" value={stats.people} />
        <StatCard label="Open Tasks" value={stats.openTasks} />
        <StatCard label="Overdue Tasks" value={stats.overdueTasks} accent={stats.overdueTasks ? 'red' : 'green'} />
        <StatCard label="Waiting / On Hold" value={stats.awaitingInput + stats.onHold} accent={stats.awaitingInput + stats.onHold ? 'amber' : undefined} />
        <StatCard label="Working Now" value={stats.runningNow} accent="green" />
        <StatCard label="Hours This Week" value={stats.hoursWeek} foot={`${stats.hoursToday}h today`} />
        <StatCard label="Logged vs Allocated" value={`${stats.loggedHours} / ${stats.allocatedHours}h`} foot="On open work" />
        <StatCard label="Without Allocation" value={stats.withoutAllocation} accent={stats.withoutAllocation ? 'amber' : 'green'} foot="People with no open work" />
        <StatCard label="Projects At Risk" value={`${stats.atRiskProjects} / ${stats.activeProjects}`} accent={stats.atRiskProjects ? 'amber' : 'green'} />
        <StatCard label="Exceptions" value={stats.exceptions} accent={stats.criticalExceptions ? 'red' : stats.exceptions ? 'amber' : 'green'} foot={`${stats.criticalExceptions} critical`} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div><h3>Task status</h3></div></div>
        <div className="card-pad">
          <div className="pill-row">
            {TASK_STATUSES.map((s) => (
              <StatusBadge key={s} status={taskBadgeStatus(s)}>{s}: {statusCounts[s] || 0}</StatusBadge>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div><h3>Needs attention</h3><div className="card-head-sub">Most urgent first</div></div><Link className="btn btn-sm" to="/exceptions">View all</Link></div>
        <div className="card-pad">
          {exceptions.length === 0 ? <EmptyState title="Nothing needs attention" sub="No overdue work, overruns or blocked tasks." /> : exceptions.map((e) => (
            <div className="detail-row" key={e.key} style={{ alignItems: 'center', gap: 12 }}>
              <StatusBadge severity={e.severity === 'critical' ? 'red' : 'amber'}>{e.category}</StatusBadge>
              <div style={{ flex: 1 }}>
                <div className="cell-primary">{e.title}</div>
                <div className="cell-sub">{e.detail}</div>
              </div>
              <Link className="link-btn" to={`/projects/${e.projectId}`}>{e.projectName}</Link>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div><h3>People</h3><div className="card-head-sub">Workload and live activity</div></div></div>
        <DataTable columns={peopleColumns} rows={people} emptyTitle="No people yet" emptySub="Nobody is assigned to this scope." />
      </div>

      <div className="card">
        <div className="card-head"><div><h3>Active projects</h3></div><Link className="btn btn-sm" to="/man-hours">Man-hour detail</Link></div>
        <DataTable columns={projectColumns} rows={projects} emptyTitle="No active projects" emptySub="Projects show here once work is under way." />
      </div>
    </>
  );
}
