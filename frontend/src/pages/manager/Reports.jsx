import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/layout/PageHeader';
import Tabs from '../../components/common/Tabs';
import DataTable from '../../components/common/DataTable';
import StatusBadge from '../../components/common/StatusBadge';
import ProgressBar from '../../components/common/ProgressBar';
import SearchInput from '../../components/common/SearchInput';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import * as reportsApi from '../../api/reports';
import * as departmentsApi from '../../api/departments';
import * as timelogsApi from '../../api/timelogs';
import AdjustSessionModal from '../../components/sessions/AdjustSessionModal';
import { fmtHours } from '../../utils/formatters';
import { exportToExcel, exportToPdf, exportToCsv } from '../../utils/exportReport';

const PROJECT_COLUMNS = [
  { header: 'Job Code', value: (r) => r.jobCode },
  { header: 'Project', value: (r) => r.name },
  { header: 'Client', value: (r) => r.clientName },
  { header: 'Project Manager', value: (r) => r.projectManagerName },
  { header: 'Departments', value: (r) => r.departments.join(', ') },
  { header: 'Tasks', value: (r) => r.taskCount ?? 0 },
  { header: 'Completed MH', value: (r) => r.completedManHours },
  { header: 'Estimated MH', value: (r) => r.estimatedManHours },
  { header: 'Progress %', value: (r) => r.pct },
  { header: 'Priority', value: (r) => r.priority },
  { header: 'Status', value: (r) => r.status },
];

const EMPLOYEE_COLUMNS = [
  { header: 'Employee', value: (r) => r.name },
  { header: 'Department', value: (r) => r.department },
  { header: 'Tasks Assigned', value: (r) => r.taskCount },
  { header: 'Logged Sessions', value: (r) => r.sessionCount },
  { header: 'Total Hours Logged', value: (r) => r.totalHours },
];

export default function Reports() {
  const { pushToast } = useApp();
  const { can } = useAuth();
  const canReview = can('sessions.review');
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(canReview && searchParams.get('tab') === 'review' ? 'review' : 'project');
  const [flagged, setFlagged] = useState([]);
  const [adjusting, setAdjusting] = useState(null);
  const [keepingId, setKeepingId] = useState(null);

  const [departments, setDepartments] = useState([]);
  const [projectRows, setProjectRows] = useState([]);
  const [employeeRows, setEmployeeRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [projSearch, setProjSearch] = useState('');
  const [projStatus, setProjStatus] = useState('All');
  const [projDept, setProjDept] = useState('All');

  const [empSearch, setEmpSearch] = useState('');
  const [empDept, setEmpDept] = useState('All');
  const [empTeam, setEmpTeam] = useState('All');
  const [empProject, setEmpProject] = useState('All');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  async function loadProjects() {
    const projects = await reportsApi.projectDetailsReport();
    setProjectRows(projects.map((p) => ({ ...p, pct: Math.min(100, Math.round((p.completedManHours / p.estimatedManHours) * 100)) })));
  }

  async function loadEmployees() {
    const employees = await reportsApi.employeeWorkTimeReport({
      from,
      to,
      projectId: empProject === 'All' ? '' : empProject,
      departmentId: empDept === 'All' ? '' : empDept,
      teamId: empTeam === 'All' ? '' : empTeam,
    });
    setEmployeeRows(employees);
  }

  async function loadFlagged() {
    if (!canReview) return;
    const data = await timelogsApi.listFlaggedSessions();
    setFlagged(data.timeLogs);
  }

  async function loadInitial() {
    setLoading(true);
    setError('');
    try {
      const [depts] = await Promise.all([departmentsApi.listDepartments(), loadProjects(), loadEmployees(), loadFlagged()]);
      setDepartments(depts);
    } catch (err) {
      setError(err.message || 'Failed to load reports.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadInitial(); }, []);

  // Server-side filters (date range, project, department) re-query the employee report.
  useEffect(() => {
    if (loading) return;
    loadEmployees().catch((err) => pushToast(err.message || 'Failed to refresh report.'));
  }, [from, to, empProject, empDept, empTeam]);

  // The teams to offer: those of the chosen department, or every team.
  const teamChoices = useMemo(() => departments
    .filter((d) => empDept === 'All' || String(d.department_id) === String(empDept))
    .flatMap((d) => (d.teams || []).map((t) => ({ id: t.id, name: t.name, department: d.name }))), [departments, empDept]);

  const filteredProjects = useMemo(() => {
    const q = projSearch.toLowerCase();
    return projectRows.filter((p) => {
      const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.jobCode.toLowerCase().includes(q) || (p.clientName || '').toLowerCase().includes(q);
      const matchesStatus = projStatus === 'All' || p.status === projStatus;
      const matchesDept = projDept === 'All' || p.departments.includes(projDept);
      return matchesSearch && matchesStatus && matchesDept;
    });
  }, [projectRows, projSearch, projStatus, projDept]);

  const filteredEmployees = useMemo(() => {
    const q = empSearch.toLowerCase();
    return employeeRows.filter((e) => !q || e.name.toLowerCase().includes(q));
  }, [employeeRows, empSearch]);

  async function handleKeep(session) {
    setKeepingId(session.id);
    try {
      await timelogsApi.adjustSession(session.id, session.durationMinutes, 'Reviewed and kept as recorded');
      setFlagged((prev) => prev.filter((s) => s.id !== session.id));
      pushToast('Session approved as recorded.');
    } catch (err) {
      pushToast(err.message || 'Failed to approve session.');
    } finally {
      setKeepingId(null);
    }
  }

  function handleAdjusted(updated) {
    setFlagged((prev) => prev.filter((s) => s.id !== updated.id));
    setAdjusting(null);
    loadProjects().catch(() => {});
    loadEmployees().catch(() => {});
  }

  async function handleExport(kind) {
    const isProject = tab === 'project';
    const rows = isProject ? filteredProjects : filteredEmployees;
    if (rows.length === 0) {
      pushToast('Nothing to export for the current filters.');
      return;
    }
    const config = isProject
      ? { fileName: 'project-details-report', title: 'Project Details Report', subtitle: `${rows.length} project(s)`, columns: PROJECT_COLUMNS, rows }
      : {
        fileName: 'employee-work-time-report',
        title: 'Employee Work-Time Report',
        subtitle: from || to ? `${from || 'start'} to ${to || 'today'}` : 'All dates',
        columns: EMPLOYEE_COLUMNS,
        rows,
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

  return (
    <>
      <PageHeader
        title="Reports"
        sub="Project details and employee work-time reports"
        actions={<>
          {tab !== 'review' && <button className="btn" onClick={() => handleExport('pdf')} disabled={exporting || loading}>Export PDF</button>}
          {tab !== 'review' && <button className="btn" onClick={() => handleExport('csv')} disabled={exporting || loading}>Export CSV</button>}
          {tab !== 'review' && <button className="btn" onClick={() => handleExport('xlsx')} disabled={exporting || loading}>Export Excel</button>}
        </>}
      />

      <div className="card">
        <div className="card-pad">
          <Tabs
            items={[
              { label: 'Project Details Report', value: 'project' },
              { label: 'Employee Work-Time Report', value: 'employee' },
              ...(canReview ? [{ label: flagged.length ? `Session Review (${flagged.length})` : 'Session Review', value: 'review' }] : []),
            ]}
            active={tab}
            onChange={setTab}
          />

          {loading ? (
            <Loading label="Loading reports…" />
          ) : error ? (
            <EmptyState
              icon="AlertTriangle"
              title="Couldn't load reports"
              sub={error}
              action={<button className="btn" style={{ marginTop: 12 }} onClick={loadInitial}>Retry</button>}
            />
          ) : tab === 'review' ? (
            <>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
                Timers left running past the limit are stopped automatically and credited the limit. Confirm each one, or correct it with the real time worked.
              </div>
              <DataTable
                columns={[
                  { key: 'emp', header: 'Employee', render: (r) => r.employeeName },
                  { key: 'task', header: 'Task', render: (r) => (
                    <div>
                      <div className="cell-primary">{r.taskName}</div>
                      <div className="cell-sub mono">{r.projectJobCode} · {r.projectName}</div>
                    </div>
                  ) },
                  { key: 'date', header: 'Date', render: (r) => <span className="mono">{r.logDate}</span> },
                  { key: 'credited', header: 'Credited', render: (r) => fmtHours(r.durationMinutes) },
                  { key: 'actions', header: '', render: (r) => (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-sm" onClick={() => handleKeep(r)} disabled={keepingId === r.id}>Keep</button>
                      <button className="btn btn-sm btn-primary" onClick={() => setAdjusting(r)}>Adjust</button>
                    </div>
                  ) },
                ]}
                rows={flagged}
                emptyTitle="Nothing to review"
                emptySub="Sessions that are stopped automatically will appear here."
              />
            </>
          ) : tab === 'project' ? (
            <>
              <div className="filter-bar">
                <SearchInput value={projSearch} onChange={setProjSearch} placeholder="Search by project, job code or client..." />
                <select className="filter-select" value={projStatus} onChange={(e) => setProjStatus(e.target.value)}>
                  <option value="All">All Statuses</option>
                  <option>Planning</option><option>In Progress</option><option>On Hold</option><option>Completed</option>
                </select>
                <select className="filter-select" value={projDept} onChange={(e) => setProjDept(e.target.value)}>
                  <option value="All">All Departments</option>
                  {departments.map((d) => <option key={d.department_id} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              <DataTable
                columns={[
                  { key: 'name', header: 'Project', render: (r) => (
                    <div>
                      <div className="cell-primary">{r.name}</div>
                      <div className="cell-sub mono">{r.jobCode}</div>
                    </div>
                  ) },
                  { key: 'clientName', header: 'Client' },
                  { key: 'departments', header: 'Departments', render: (r) => r.departments.join(', ') },
                  { key: 'tasks', header: 'Tasks', render: (r) => r.taskCount ?? '—' },
                  { key: 'hours', header: 'MH (Completed / Estimated)', render: (r) => `${r.completedManHours} / ${r.estimatedManHours}` },
                  { key: 'progress', header: 'Progress', render: (r) => <div style={{ minWidth: 90 }}><ProgressBar pct={r.pct} color={r.pct >= 90 ? 'red' : r.pct >= 70 ? 'amber' : 'accent'} /></div> },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status === 'In Progress' ? 'On Time' : r.status}>{r.status}</StatusBadge> },
                ]}
                rows={filteredProjects}
              />
            </>
          ) : (
            <>
              <div className="filter-bar">
                <SearchInput value={empSearch} onChange={setEmpSearch} placeholder="Search employee..." />
                <select className="filter-select" value={empDept} onChange={(e) => { setEmpDept(e.target.value); setEmpTeam('All'); }} aria-label="Department">
                  <option value="All">All Departments</option>
                  {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
                </select>
                <select className="filter-select" value={empTeam} onChange={(e) => setEmpTeam(e.target.value)} aria-label="Team">
                  <option value="All">All Teams</option>
                  {teamChoices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select className="filter-select" value={empProject} onChange={(e) => setEmpProject(e.target.value)}>
                  <option value="All">All Projects</option>
                  {projectRows.map((p) => <option key={p.id} value={p.id}>{p.jobCode} — {p.name}</option>)}
                </select>
                <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  From <input type="date" className="filter-input" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  To <input type="date" className="filter-input" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
              </div>
              <DataTable
                columns={[
                  { key: 'emp', header: 'Employee', render: (r) => (
                    <div>
                      <div className="cell-primary">{r.name}</div>
                      <div className="cell-sub">{r.department}</div>
                    </div>
                  ) },
                  { key: 'taskCount', header: 'Tasks Assigned' },
                  { key: 'sessionCount', header: 'Logged Sessions' },
                  { key: 'hours', header: 'Total Hours Logged', render: (r) => `${r.totalHours}h` },
                ]}
                rows={filteredEmployees}
              />
            </>
          )}
        </div>
      </div>
      <AdjustSessionModal session={adjusting} onClose={() => setAdjusting(null)} onSaved={handleAdjusted} />
    </>
  );
}
