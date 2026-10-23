import React, { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../components/layout/PageHeader';
import StatCard from '../../components/common/StatCard';
import StatusBadge from '../../components/common/StatusBadge';
import DataTable from '../../components/common/DataTable';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import BarChart from '../../components/charts/BarChart';
import PeriodControls from '../../components/reports/PeriodControls';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import * as reportsApi from '../../api/reports';
import * as employeesApi from '../../api/employees';
import { todayStr, describePeriod, dayLabel } from '../../utils/dates';
import { taskBadgeStatus, TASK_STATUSES } from '../../utils/taskStatus';
import { exportToExcel, exportToPdf, exportToCsv } from '../../utils/exportReport';

const EXPORT_COLUMNS = [
  { header: 'Group', value: (r) => r.group },
  { header: 'Name', value: (r) => r.name },
  { header: 'Hours', value: (r) => r.hours },
  { header: 'Tasks', value: (r) => r.tasks ?? '' },
  { header: 'Sessions', value: (r) => r.sessions ?? '' },
];

const TASK_HOLDERS = ['employee', 'team_leader'];

// One person's work over a day, week or month (SRS §28). With `own`, it is the
// signed-in person's own report; otherwise a person is chosen from those the
// signed-in person is responsible for.
export default function WorkReport({ own = false }) {
  const { user, can } = useAuth();
  const { pushToast } = useApp();
  const [people, setPeople] = useState([]);
  const [personId, setPersonId] = useState(own ? user.id : null);
  const [view, setView] = useState({ period: 'week', date: todayStr() });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (own || !can('employees.view')) return;
    employeesApi.listEmployees()
      .then((all) => {
        const list = all.filter((e) => TASK_HOLDERS.includes(e.role) && e.status === 'active');
        setPeople(list);
        setPersonId((current) => current ?? (list[0] ? list[0].id : null));
      })
      .catch((err) => setError(err.message || 'Failed to load people.'));
  }, [own]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (personId == null) return;
    setError('');
    setData(null);
    try {
      setData(await reportsApi.employeeReport(personId, view.period, view.date));
    } catch (err) {
      setError(err.message || 'Failed to load the report.');
    }
  }

  useEffect(() => { load(); }, [personId, view.period, view.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportRows = useMemo(() => (data ? [
    ...data.byProject.map((r) => ({ ...r, group: 'Project', name: `${r.jobCode} — ${r.name}` })),
    ...data.byCategory.map((r) => ({ ...r, group: 'Category' })),
    ...data.daily.map((d) => ({ group: 'Day', name: d.date, hours: d.hours })),
  ] : []), [data]);

  async function handleExport(kind) {
    const config = {
      fileName: `work-report-${data.employee.name.toLowerCase().replace(/\s+/g, '-')}-${data.from}`,
      title: `Work Report — ${data.employee.name}`,
      subtitle: `${describePeriod(data.period, data.from, data.to)} · ${data.totalHours} hours`,
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

  const noPeople = !own && people.length === 0 && personId == null && !error;

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
        title={own ? 'My Report' : 'Work Report'}
        sub={own ? 'Your hours, projects and finished work' : 'One person’s hours, projects and finished work'}
        actions={<>
          <button className="btn" onClick={() => handleExport('pdf')} disabled={!data || exporting}>Export PDF</button>
          <button className="btn" onClick={() => handleExport('csv')} disabled={!data || exporting}>Export CSV</button>
          <button className="btn" onClick={() => handleExport('xlsx')} disabled={!data || exporting}>Export Excel</button>
        </>}
      />

      {!own && (
        <div className="filter-bar">
          <select className="filter-select" aria-label="Person" value={personId ?? ''} onChange={(e) => setPersonId(Number(e.target.value))} disabled={people.length === 0}>
            {people.length === 0 && <option value="">No people</option>}
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.department ? ` — ${p.department}` : ''}</option>)}
          </select>
        </div>
      )}

      <PeriodControls period={view.period} date={view.date} onChange={setView} />

      {noPeople ? (
        <EmptyState title="Nobody to report on" sub="There are no people in your scope yet." />
      ) : error ? (
        <EmptyState icon="AlertTriangle" title="Couldn't load the report" sub={error} action={<button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button>} />
      ) : !data ? <Loading label="Loading the report…" /> : (
        <>
          <div className="muted" style={{ marginBottom: 12 }}>
            <strong>{data.employee.name}</strong>
            {data.employee.designation ? ` · ${data.employee.designation}` : ''}
            {data.employee.department ? ` · ${data.employee.department}` : ''}
            {data.employee.team ? ` · ${data.employee.team}` : ''}
            {' — '}{describePeriod(data.period, data.from, data.to)}
          </div>

          <div className="stat-grid">
            <StatCard label="Hours Logged" value={`${data.totalHours}h`} accent="green" />
            <StatCard label="Days Worked" value={data.daysWorked} foot={`${data.averageHoursPerDayWorked}h per day worked`} />
            <StatCard label="Sessions" value={data.sessionCount} />
            <StatCard label="Tasks Finished" value={data.tasksCompletedInPeriod} />
            <StatCard label="Open Work (planned)" value={`${data.openPlannedHours}h`} />
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

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head"><div><h3>Task status</h3><div className="card-head-sub">Their current tasks</div></div></div>
            <div className="card-pad">
              <div className="pill-row">
                {TASK_STATUSES.map((s) => <StatusBadge key={s} status={taskBadgeStatus(s)}>{s}: {data.taskStatus[s] || 0}</StatusBadge>)}
              </div>
            </div>
          </div>

          {table('Project distribution', data.byProject, true)}
          {table('Task categories', data.byCategory)}
        </>
      )}
    </>
  );
}
