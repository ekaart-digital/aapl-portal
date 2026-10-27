import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/layout/PageHeader';
import StatCard from '../../components/common/StatCard';
import DataTable from '../../components/common/DataTable';
import StatusBadge from '../../components/common/StatusBadge';
import ProgressBar from '../../components/common/ProgressBar';
import SearchInput from '../../components/common/SearchInput';
import Drawer from '../../components/common/Drawer';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import * as projectsApi from '../../api/projects';
import * as departmentsApi from '../../api/departments';
import * as timelogsApi from '../../api/timelogs';

const emptyForm = {
  name: '', jobCode: '', clientName: '', consultantName: '', mainContractorName: '', mapContractorName: '',
  projectManagerId: '', departmentIds: [], startDate: '', targetDate: '', priority: 'Medium', estimatedManHours: '',
};

export default function Projects() {
  const { user, can } = useAuth();
  const { pushToast } = useApp();
  const navigate = useNavigate();
  const canCreate = can('projects.create');
  // The queue of sessions to review is on the Reports screen, so only offer it when that is open.
  const canReview = can('sessions.review') && can('reports.view');

  const [projects, setProjects] = useState([]);
  const [managers, setManagers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewCount, setReviewCount] = useState(0);

  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm, projectManagerId: user.id });
  const [submitting, setSubmitting] = useState(false);

  async function loadProjects() {
    setLoading(true);
    setError('');
    try {
      const data = await projectsApi.listProjects();
      setProjects(data);
    } catch (err) {
      setError(err.message || 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
    if (canCreate) {
      projectsApi.listProjectManagers().then(setManagers).catch(() => {});
      departmentsApi.listDepartments().then(setDepartments).catch(() => {});
    }
    if (canReview) {
      timelogsApi.listFlaggedSessions().then((d) => setReviewCount(d.timeLogs.length)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    return projects
      .map((p) => ({ ...p, pct: Math.min(100, Math.round((p.completedManHours / p.estimatedManHours) * 100)) }))
      .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.jobCode.toLowerCase().includes(search.toLowerCase()) || p.clientName.toLowerCase().includes(search.toLowerCase()));
  }, [projects, search]);

  const totalEstimated = projects.reduce((s, p) => s + p.estimatedManHours, 0);
  const totalCompleted = projects.reduce((s, p) => s + p.completedManHours, 0);
  const inProgress = projects.filter((p) => p.status === 'In Progress').length;

  function toggleDept(id) {
    setForm((f) => ({
      ...f,
      departmentIds: f.departmentIds.includes(id) ? f.departmentIds.filter((d) => d !== id) : [...f.departmentIds, id],
    }));
  }

  async function handleCreate() {
    if (!form.name || !form.jobCode || !form.clientName || !form.estimatedManHours || form.departmentIds.length === 0) {
      pushToast('Please fill in project name, job code, client, estimated hours and at least one department.');
      return;
    }
    setSubmitting(true);
    try {
      const newProject = await projectsApi.createProject({
        name: form.name,
        jobCode: form.jobCode,
        clientName: form.clientName,
        consultantName: form.consultantName,
        mainContractorName: form.mainContractorName,
        mapContractorName: form.mapContractorName,
        projectManagerId: form.projectManagerId,
        departmentIds: form.departmentIds,
        startDate: form.startDate || undefined,
        targetDate: form.targetDate || undefined,
        priority: form.priority,
        estimatedManHours: Number(form.estimatedManHours),
      });
      setProjects((prev) => [newProject, ...prev]);
      setDrawerOpen(false);
      setForm({ ...emptyForm, projectManagerId: user.id });
      pushToast(`Project ${newProject.jobCode} created.`);
    } catch (err) {
      pushToast(err.message || 'Failed to create project.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Projects"
        sub="All active engineering projects"
        actions={canCreate ? <button className="btn btn-primary" onClick={() => setDrawerOpen(true)}>+ New Project</button> : null}
      />

      {loading ? (
        <Loading label="Loading projects…" />
      ) : error ? (
        <EmptyState
          icon="AlertTriangle"
          title="Couldn't load projects"
          sub={error}
          action={<button className="btn" style={{ marginTop: 12 }} onClick={loadProjects}>Retry</button>}
        />
      ) : (
        <>
          {canReview && reviewCount > 0 && (
            <div className="notice-banner" role="status">
              <div>
                <strong>{reviewCount}</strong> timer session{reviewCount === 1 ? ' was' : 's were'} stopped automatically after being left running and need{reviewCount === 1 ? 's' : ''} your review.
              </div>
              <div className="notice-actions">
                <button className="btn btn-sm btn-primary" onClick={() => navigate('/reports?tab=review')}>Review</button>
              </div>
            </div>
          )}
          <div className="stat-grid">
            <StatCard label="Active Projects" value={projects.length} />
            <StatCard label="In Progress" value={inProgress} accent="green" />
            <StatCard label="Total Estimated MH" value={totalEstimated.toLocaleString()} />
            <StatCard label="Total Completed MH" value={totalCompleted.toLocaleString()} />
          </div>

          <div className="card">
            <div className="card-head">
              <h3>All Projects</h3>
              <span className="card-head-sub">{rows.length} of {projects.length}</span>
            </div>
            <div className="card-pad">
              <div className="filter-bar">
                <SearchInput value={search} onChange={setSearch} placeholder="Search by name, job code or client..." />
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
                  { key: 'pm', header: 'Project Manager', render: (r) => r.projectManagerName || '—' },
                  { key: 'hours', header: 'MH (Completed / Estimated)', render: (r) => `${r.completedManHours} / ${r.estimatedManHours}` },
                  { key: 'progress', header: 'Progress', render: (r) => (
                    <div style={{ minWidth: 100 }}>
                      <ProgressBar pct={r.pct} color={r.pct >= 90 ? 'red' : r.pct >= 70 ? 'amber' : 'accent'} />
                    </div>
                  ) },
                  { key: 'priority', header: 'Priority' },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status === 'In Progress' ? 'On Time' : r.status} >{r.status}</StatusBadge> },
                ]}
                rows={rows}
                onRowClick={(r) => navigate(`/projects/${r.id}`)}
              />
            </div>
          </div>
        </>
      )}

      {canCreate && (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="New Project"
          subtitle="Create a new project"
          footer={<>
            <button className="btn" onClick={() => setDrawerOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={submitting}>{submitting ? 'Creating…' : 'Create Project'}</button>
          </>}
        >
          <FormField label="Project name">
            <input className="filter-input" style={{ width: '100%' }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Saria Refinery Expansion" />
          </FormField>
          <FormField label="Job code">
            <input className="filter-input" style={{ width: '100%' }} value={form.jobCode} onChange={(e) => setForm({ ...form, jobCode: e.target.value })} placeholder="e.g. AAPL-26-0900" />
          </FormField>
          <FormField label="Client name">
            <input className="filter-input" style={{ width: '100%' }} value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
          </FormField>
          <FormField label="Consultant name">
            <input className="filter-input" style={{ width: '100%' }} value={form.consultantName} onChange={(e) => setForm({ ...form, consultantName: e.target.value })} />
          </FormField>
          <FormField label="Main contractor name">
            <input className="filter-input" style={{ width: '100%' }} value={form.mainContractorName} onChange={(e) => setForm({ ...form, mainContractorName: e.target.value })} />
          </FormField>
          <FormField label="MAP contractor name">
            <input className="filter-input" style={{ width: '100%' }} value={form.mapContractorName} onChange={(e) => setForm({ ...form, mapContractorName: e.target.value })} />
          </FormField>
          <FormField label="Project manager">
            <select className="filter-select" style={{ width: '100%' }} value={form.projectManagerId} onChange={(e) => setForm({ ...form, projectManagerId: e.target.value })}>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </FormField>
          <FormField label="Departments involved">
            <div className="pill-row">
              {departments.map((d) => (
                <span
                  key={d.department_id}
                  className={`badge ${form.departmentIds.includes(d.department_id) ? 'badge-blue' : 'badge-grey'}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleDept(d.department_id)}
                >
                  {d.name}
                </span>
              ))}
            </div>
          </FormField>
          <div className="grid-2">
            <FormField label="Start date">
              <input type="date" className="filter-input" style={{ width: '100%' }} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </FormField>
            <FormField label="Target completion">
              <input type="date" className="filter-input" style={{ width: '100%' }} value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} />
            </FormField>
          </div>
          <div className="grid-2">
            <FormField label="Priority">
              <select className="filter-select" style={{ width: '100%' }} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
              </select>
            </FormField>
            <FormField label="Estimated man-hours">
              <input type="number" className="filter-input" style={{ width: '100%' }} value={form.estimatedManHours} onChange={(e) => setForm({ ...form, estimatedManHours: e.target.value })} />
            </FormField>
          </div>
        </Drawer>
      )}
    </>
  );
}

function FormField({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}
