import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/layout/PageHeader';
import StatCard from '../../components/common/StatCard';
import StatusBadge from '../../components/common/StatusBadge';
import DataTable from '../../components/common/DataTable';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import BarChart from '../../components/charts/BarChart';
import PeriodControls from '../../components/reports/PeriodControls';
import RiskBadge from './RiskBadge';
import { useApp } from '../../context/AppContext';
import * as reportsApi from '../../api/reports';
import { todayStr, describePeriod, dayLabel } from '../../utils/dates';
import { exportToExcel, exportToPdf, exportToCsv } from '../../utils/exportReport';

const EXPORT_COLUMNS = [
  { header: 'Group', value: (r) => r.group },
  { header: 'Name', value: (r) => r.name },
  { header: 'Hours', value: (r) => r.hours },
  { header: 'Tasks', value: (r) => r.tasks },
  { header: 'Sessions', value: (r) => r.sessions },
];

const TITLES = { day: 'End-of-Day Summary', week: 'Weekly Summary', month: 'Monthly Summary' };

// The end-of-day, weekly and monthly summaries (SRS §31 to §33) in one screen:
// hours by project, department, person and category, a daily trend, projects
// nearing their budget and the major exceptions, for the user's own scope.
export default function Summary() {
  const { pushToast } = useApp();
  const [view, setView] = useState({ period: 'day', date: todayStr() });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  async function load() {
    setError('');
    setData(null);
    try {
      setData(await reportsApi.summaryReport(view.period, view.date));
    } catch (err) {
      setError(err.message || 'Failed to load the summary.');
    }
  }

  useEffect(() => { load(); }, [view.period, view.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportRows = useMemo(() => (data ? [
    ...data.byProject.map((r) => ({ ...r, group: 'Project', name: `${r.jobCode} — ${r.name}` })),
    ...data.byDepartment.map((r) => ({ ...r, group: 'Department' })),
    ...data.byEmployee.map((r) => ({ ...r, group: 'Employee' })),
    ...data.byCategory.map((r) => ({ ...r, group: 'Category' })),
  ] : []), [data]);

  async function handleExport(kind) {
    const config = {
      fileName: `${view.period}-summary-${data.from}`,
      title: `${TITLES[data.period]} — ${describePeriod(data.period, data.from, data.to)}`,
      subtitle: `${data.totalHours} hours logged`,
      columns: EXPORT_COLUMNS,
      rows: exportRows,
    };
    setExporting(true);
    try {
      if (kind === 'pdf') await exportToPdf(config);
      else if (kind === 'csv') await exportToCsv(config);
      else await exportToExcel(config);
    } catch (err) {
      pushToast(err.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  const table = (title, rows, withCode) => (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><div><h3>{title}</h3></div></div>
      <DataTable
        columns={[
          { key: 'name', header: 'Name', render: (r) => (withCode ? <><div className="cell-primary">{r.name}</div><div className="cell-sub">{r.jobCode}</div></> : r.name) },
          { key: 'hours', header: 'Hours', className: 'mono', render: (r) => `${r.hours}h` },
          { key: 'tasks', header: 'Tasks', className: 'mono', render: (r) => r.tasks },
          { key: 'sessions', header: 'Sessions', className: 'mono', render: (r) => r.sessions },
        ]}
        rows={rows}
        emptyTitle="Nothing logged"
        emptySub="No time was logged in this period."
      />
    </div>
  );

  return (
    <>
      <PageHeader
        title={TITLES[view.period]}
        sub="Hours, finished work, projects nearing their budget and what needs attention"
        actions={<>
          <button className="btn" onClick={() => handleExport('pdf')} disabled={!data || exporting}>Export PDF</button>
          <button className="btn" onClick={() => handleExport('csv')} disabled={!data || exporting}>Export CSV</button>
          <button className="btn" onClick={() => handleExport('xlsx')} disabled={!data || exporting}>Export Excel</button>
        </>}
      />

      <PeriodControls period={view.period} date={view.date} onChange={setView} />

      {error ? (
        <EmptyState icon="AlertTriangle" title="Couldn't load the summary" sub={error} action={<button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button>} />
      ) : !data ? <Loading label="Loading the summary…" /> : (
        <>
          <div className="muted" style={{ marginBottom: 12 }}>{describePeriod(data.period, data.from, data.to)}</div>

          <div className="stat-grid">
            <StatCard label="Hours Logged" value={`${data.totalHours}h`} accent="green" foot={`${data.sessionCount} sessions`} />
            <StatCard
              label="People Who Logged"
              value={data.people ? `${data.people.withHours} / ${data.people.total}` : data.peopleWhoLogged}
              foot={data.people ? `${data.people.withoutHours} without hours` : undefined}
              accent={data.people && data.people.withoutHours ? 'amber' : undefined}
            />
            <StatCard label="Tasks Finished" value={data.tasksCompleted} />
            <StatCard label="Overdue Tasks" value={data.overdueTasks} accent={data.overdueTasks ? 'red' : 'green'} />
            <StatCard label="Projects Nearing Budget" value={data.projectsNearingBudget.length} accent={data.projectsNearingBudget.length ? 'amber' : 'green'} />
          </div>

          {data.period !== 'day' && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><div><h3>Hours by day</h3></div></div>
              <div className="card-pad">
                <BarChart
                  data={data.daily.map((d) => ({ label: dayLabel(d.date, data.period), hours: d.hours }))}
                  keys={[{ key: 'hours', color: 'var(--accent)', name: 'Hours' }]}
                  height={180}
                />
              </div>
            </div>
          )}

          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head"><div><h3>Projects nearing or over budget</h3></div><Link className="btn btn-sm" to="/man-hours">Man-hours</Link></div>
              <div className="card-pad">
                {data.projectsNearingBudget.length === 0 ? <EmptyState title="All projects are within budget" sub="No project is near or over its estimated man-hours." /> : data.projectsNearingBudget.map((p) => (
                  <div className="detail-row" key={p.id} style={{ alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div className="cell-primary">{p.name}</div>
                      <div className="cell-sub">{p.jobCode} · {p.consumedPercent}% of budget used, {p.completionPercent}% done</div>
                    </div>
                    <RiskBadge risk={p.risk} />
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><div><h3>Major exceptions</h3></div><Link className="btn btn-sm" to="/exceptions">All exceptions</Link></div>
              <div className="card-pad">
                {data.majorExceptions.length === 0 ? <EmptyState title="Nothing critical" sub="No critical exceptions right now." /> : data.majorExceptions.map((e) => (
                  <div className="detail-row" key={e.key} style={{ alignItems: 'center', gap: 12 }}>
                    <StatusBadge severity="red">{e.category}</StatusBadge>
                    <div style={{ flex: 1 }}>
                      <div className="cell-primary">{e.title}</div>
                      <div className="cell-sub">{e.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {table('Top projects by hours', data.topProjects, true)}
          {table('By department', data.byDepartment)}
          {table('By person', data.byEmployee)}
          {table('By task category', data.byCategory)}
        </>
      )}
    </>
  );
}
