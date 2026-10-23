import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/layout/PageHeader';
import StatusBadge from '../../components/common/StatusBadge';
import { TASK_STATUSES, taskBadgeStatus } from '../../utils/taskStatus';
import ProgressBar from '../../components/common/ProgressBar';
import DataTable from '../../components/common/DataTable';
import Avatar from '../../components/common/Avatar';
import Drawer from '../../components/common/Drawer';
import Modal from '../../components/common/Modal';
import EmptyState from '../../components/common/EmptyState';
import Loading from '../../components/common/Loading';
import { useApp } from '../../context/AppContext';
import * as projectsApi from '../../api/projects';
import * as tasksApi from '../../api/tasks';
import AdjustSessionModal from '../../components/sessions/AdjustSessionModal';
import { fmtHours } from '../../utils/formatters';
import * as departmentsApi from '../../api/departments';

const emptyForm = { departmentId: '', subDepartmentId: '', taskName: '', category: '', employeeId: '', allocatedHours: '', dueDate: '', remarks: '' };

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { pushToast } = useApp();

  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [allDepartments, setAllDepartments] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [managerChoices, setManagerChoices] = useState([]);
  const [teamLeaderChoices, setTeamLeaderChoices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const [projectEditOpen, setProjectEditOpen] = useState(false);
  const [projectForm, setProjectForm] = useState(null);
  const [editTask, setEditTask] = useState(null);
  const [taskForm, setTaskForm] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [adjusting, setAdjusting] = useState(null);

  async function loadAll() {
    setLoading(true);
    setError('');
    setMissing(false);
    try {
      const [projectData, taskData] = await Promise.all([
        projectsApi.getProject(id),
        projectsApi.listProjectTasks(id),
      ]);
      setProject(projectData);
      setTasks(taskData);
      // What this person may do with the project, as decided by the server.
      const perms = projectData.permissions || {};
      if (perms.allocate || perms.edit) {
        const [depts, people] = await Promise.all([
          departmentsApi.listDepartments(),
          projectsApi.listAssignees(id),
        ]);
        setAllDepartments(depts);
        setAssignees(people);
        tasksApi.listCategories().then(setCategories).catch(() => setCategories([]));
      }
      if (perms.edit) {
        const [managers, leaders] = await Promise.all([projectsApi.listProjectManagers(), projectsApi.listTeamLeaders()]);
        setManagerChoices(managers);
        setTeamLeaderChoices(leaders);
      }
    } catch (err) {
      if (err.status === 403 || err.status === 404) setMissing(true);
      else setError(err.message || 'Failed to load project.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const projectDepartments = useMemo(() => {
    if (!project) return [];
    return project.departments.map((pd) => allDepartments.find((d) => d.department_id === pd.id)).filter(Boolean);
  }, [project, allDepartments]);

  // Only the departments this person can actually give work to here (the server
  // already limited the assignees: a Department Head gets only their own people).
  const assignableDepartments = useMemo(
    () => projectDepartments.filter((d) => assignees.some((a) => a.departmentId === d.department_id)),
    [projectDepartments, assignees]
  );

  function openAssignDrawer() {
    // With only one choice there is nothing to decide, so it is already selected.
    setForm(assignableDepartments.length === 1 ? { ...emptyForm, departmentId: String(assignableDepartments[0].department_id) } : emptyForm);
    setDrawerOpen(true);
  }

  const availableSubDepts = form.departmentId ? (allDepartments.find((d) => d.department_id === Number(form.departmentId))?.subDepartments || []) : [];
  const availableEmployees = form.departmentId ? assignees.filter((e) => e.departmentId === Number(form.departmentId)) : [];

  const managers = managerChoices;
  const departmentsWithTasks = useMemo(() => new Set(tasks.map((t) => t.departmentId)), [tasks]);
  const reassignOptions = useMemo(() => {
    if (!editTask) return [];
    const choices = assignees.filter((e) => e.departmentId === editTask.departmentId);
    // Keep the current assignee selectable even if they are outside the picker's list.
    return choices.some((e) => e.id === editTask.employeeId)
      ? choices
      : [{ id: editTask.employeeId, name: editTask.employeeName, designation: '' }, ...choices];
  }, [assignees, editTask]);

  const allocationRows = useMemo(() => {
    const map = new Map();
    tasks.forEach((t) => {
      if (!map.has(t.employeeId)) map.set(t.employeeId, { name: t.employeeName, hours: 0 });
      map.get(t.employeeId).hours += t.allocatedHours;
    });
    return Array.from(map.entries()).map(([empId, v]) => ({ empId, ...v }));
  }, [tasks]);

  const assignedRows = useMemo(() => {
    if (project?.assignedEmployees) {
      return project.assignedEmployees.map((p) => ({ empId: p.id, name: p.name, hours: p.plannedHours, used: p.consumedHours }));
    }
    return allocationRows;
  }, [project, allocationRows]);

  if (loading) return <Loading label="Loading project…" />;
  if (missing) {
    return (
      <>
        <PageHeader title="Project not found" sub="This project doesn't exist, or you don't have access to it." />
        <button className="btn" onClick={() => navigate('/projects')}>Back to Projects</button>
      </>
    );
  }
  if (error) {
    return (
      <EmptyState
        icon="AlertTriangle"
        title="Couldn't load this project"
        sub={error}
        action={<button className="btn" style={{ marginTop: 12 }} onClick={loadAll}>Retry</button>}
      />
    );
  }
  if (!project) {
    return (
      <>
        <PageHeader title="Project not found" sub="This project may not exist." />
        <button className="btn" onClick={() => navigate('/projects')}>Back to Projects</button>
      </>
    );
  }

  const canEdit = Boolean(project.permissions?.edit);
  const canAllocate = Boolean(project.permissions?.allocate);
  const completedHours = project.completedManHours;
  const remaining = Math.max(0, project.estimatedManHours - completedHours);
  const consumedPct = Math.round((completedHours / project.estimatedManHours) * 100);
  const risk = consumedPct >= 95 ? 'red' : consumedPct >= 80 ? 'amber' : 'green';

  function openProjectEdit() {
    setProjectForm({
      name: project.name,
      clientName: project.clientName || '',
      consultantName: project.consultantName || '',
      mainContractorName: project.mainContractorName || '',
      mapContractorName: project.mapContractorName || '',
      startDate: project.startDate || '',
      targetDate: project.targetDate || '',
      priority: project.priority,
      estimatedManHours: project.estimatedManHours,
      status: project.status,
      projectManagerId: project.projectManagerId,
      teamLeaderId: project.teamLeaderId ?? '',
      agreedFee: project.agreedFee ?? '',
      completionOverridePercent: project.completionOverridePercent ?? '',
      departmentIds: project.departments.map((d) => d.id),
    });
    setProjectEditOpen(true);
  }

  async function handleSaveProject() {
    if (!projectForm.name || !projectForm.clientName || !(Number(projectForm.estimatedManHours) > 0)) {
      pushToast('Project name, client and a positive estimated man-hours value are required.');
      return;
    }
    setSubmitting(true);
    try {
      const { teamLeaderId, agreedFee, completionOverridePercent, ...basics } = projectForm;
      const payload = { ...basics, estimatedManHours: Number(projectForm.estimatedManHours) };
      // The optional master fields are sent only when they changed; an empty box clears the value.
      const tl = teamLeaderId === '' ? null : Number(teamLeaderId);
      if (tl !== (project.teamLeaderId ?? null)) payload.teamLeaderId = tl;
      if (project.agreedFee !== undefined) {
        const fee = agreedFee === '' ? null : Number(agreedFee);
        if (fee !== (project.agreedFee ?? null)) payload.agreedFee = fee;
      }
      const pct = completionOverridePercent === '' ? null : Number(completionOverridePercent);
      if (pct !== (project.completionOverridePercent ?? null)) payload.completionOverridePercent = pct;
      if (Number(payload.projectManagerId) === project.projectManagerId) delete payload.projectManagerId;
      else payload.projectManagerId = Number(payload.projectManagerId);
      const before = project.departments.map((d) => d.id).sort((a, b) => a - b).join(',');
      if ([...payload.departmentIds].sort((a, b) => a - b).join(',') === before) delete payload.departmentIds;

      const updated = await projectsApi.updateProject(id, payload);
      setProject((prev) => ({ ...prev, ...updated }));
      setProjectEditOpen(false);
      pushToast('Project updated.');
    } catch (err) {
      pushToast(err.message || 'Failed to update project.');
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshHours() {
    try {
      const [projectData, taskData] = await Promise.all([projectsApi.getProject(id), projectsApi.listProjectTasks(id)]);
      setProject(projectData);
      setTasks(taskData);
    } catch {
      /* the next full load will correct the figures */
    }
  }

  function handleSessionSaved(updated) {
    setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setAdjusting(null);
    refreshHours();
  }

  function toggleProjectDepartment(deptId) {
    setProjectForm((f) => ({
      ...f,
      departmentIds: f.departmentIds.includes(deptId) ? f.departmentIds.filter((d) => d !== deptId) : [...f.departmentIds, deptId],
    }));
  }

  function openTaskEdit(task) {
    setEditTask(task);
    setSessions([]);
    setSessionsLoading(true);
    tasksApi.listTaskTimeLogs(task.id)
      .then(setSessions)
      .catch((err) => pushToast(err.message || 'Failed to load sessions.'))
      .finally(() => setSessionsLoading(false));
    setTaskForm({
      employeeId: task.employeeId,
      taskName: task.taskName,
      category: task.category || '',
      allocatedHours: task.allocatedHours,
      dueDate: task.dueDate || '',
      status: task.status,
      remarks: task.remarks || '',
    });
  }

  async function handleSaveTask() {
    if (!taskForm.taskName || !(Number(taskForm.allocatedHours) > 0)) {
      pushToast('Task name and a positive allocated hours value are required.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = { ...taskForm, allocatedHours: Number(taskForm.allocatedHours) };
      if (Number(payload.employeeId) === editTask.employeeId) delete payload.employeeId;
      else payload.employeeId = Number(payload.employeeId);
      const updated = await tasksApi.updateTask(editTask.id, payload);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setEditTask(null);
      pushToast('Task updated.');
    } catch (err) {
      pushToast(err.message || 'Failed to update task.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssign() {
    if (!form.departmentId || !form.subDepartmentId || !form.taskName || !form.employeeId || !form.allocatedHours) {
      pushToast('Please fill in department, sub-department, task name, employee and allocated hours.');
      return;
    }
    setSubmitting(true);
    try {
      const newTask = await projectsApi.assignTask(id, {
        subDepartmentId: Number(form.subDepartmentId),
        taskName: form.taskName,
        category: form.category || undefined,
        employeeId: Number(form.employeeId),
        allocatedHours: Number(form.allocatedHours),
        dueDate: form.dueDate || undefined,
        remarks: form.remarks || undefined,
      });
      setTasks((prev) => [...prev, newTask]);
      setDrawerOpen(false);
      setForm(emptyForm);
      pushToast(`Task assigned to ${newTask.employeeName}.`);
    } catch (err) {
      pushToast(err.message || 'Failed to assign task.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={project.name}
        sub={`${project.jobCode} · ${project.clientName}`}
        actions={<>
          <button className="btn" onClick={() => navigate('/projects')}>Back to Projects</button>
          {canEdit && <button className="btn" onClick={openProjectEdit}>Edit Project</button>}
          {canAllocate && <button className="btn btn-primary" onClick={openAssignDrawer}>+ Assign Task</button>}
        </>}
      />

      <div className="grid-main-side" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Project Overview</h3>
              <div className="card-head-sub">Project Manager: {project.projectManagerName}</div>
            </div>
            <StatusBadge severity={risk} status="">{risk === 'red' ? 'Over Budget Risk' : risk === 'amber' ? 'Approaching Budget' : 'On Track'}</StatusBadge>
          </div>
          <div className="card-pad">
            <div className="grid-3" style={{ marginBottom: 18 }}>
              <MiniStat label="Estimated MH" value={project.estimatedManHours.toLocaleString()} />
              <MiniStat label="Completed MH" value={completedHours.toLocaleString()} />
              <MiniStat label="Remaining MH" value={remaining.toLocaleString()} />
            </div>
            <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span>MH Consumed</span>
              <span className="mono" style={{ fontWeight: 600 }}>{consumedPct}%</span>
            </div>
            <ProgressBar pct={consumedPct} color={risk} />

            <div className="divider" />
            {project.completionPercent != null && (
              <>
                <div style={{ margin: '14px 0 6px', display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span>Work completed{project.completionIsManual ? ' (set by the project manager)' : ''}</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{project.completionPercent}%</span>
                </div>
                <ProgressBar pct={project.completionPercent} color="accent" />
                {project.projectedFinalManHours != null && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>On this pace the project finishes at about {project.projectedFinalManHours.toLocaleString()} MH.</div>
                )}
              </>
            )}

            <div className="divider" />
            <div className="detail-row"><span className="k">Team Leader</span><span className="v">{project.teamLeaderName || '—'}</span></div>
            {project.agreedFee !== undefined && (
              <div className="detail-row"><span className="k">Agreed Fee</span><span className="v">{project.agreedFee != null ? project.agreedFee.toLocaleString() : '—'}</span></div>
            )}
            <div className="detail-row"><span className="k">Consultant</span><span className="v">{project.consultantName || '—'}</span></div>
            <div className="detail-row"><span className="k">Main Contractor</span><span className="v">{project.mainContractorName || '—'}</span></div>
            <div className="detail-row"><span className="k">MAP Contractor</span><span className="v">{project.mapContractorName || '—'}</span></div>
            <div className="detail-row"><span className="k">Priority</span><span className="v">{project.priority}</span></div>
            <div className="detail-row"><span className="k">Start Date</span><span className="v">{project.startDate || '—'}</span></div>
            <div className="detail-row"><span className="k">Target Completion</span><span className="v">{project.targetDate || '—'}</span></div>
            <div className="detail-row"><span className="k">Departments</span><span className="v">{project.departments.map((d) => d.name).join(', ')}</span></div>
            <div className="detail-row"><span className="k">Status</span><span className="v"><StatusBadge status={project.status === 'In Progress' ? 'On Time' : project.status}>{project.status}</StatusBadge></span></div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Employee Allocation</h3></div>
          <div className="card-pad">
            {assignedRows.length === 0 ? (
              <EmptyState title="No tasks assigned yet" sub="Assign a task to see employee allocation." />
            ) : (
              assignedRows.map((row) => (
                <div key={row.empId} className="detail-row">
                  <div className="person-cell">
                    <Avatar name={row.name} />
                    <div>
                      <div className="cell-primary" style={{ fontSize: 12.8 }}>{row.name}</div>
                    </div>
                  </div>
                  <span className="v" title="Used / planned hours">{row.used != null ? `${row.used}h used of ${row.hours}h` : `${row.hours}h`}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Tasks</h3>
          <span className="card-head-sub">{tasks.length} tasks across {project.departments.length} department(s)</span>
        </div>
        <div className="card-pad">
          <DataTable
            columns={[
              { key: 'taskName', header: 'Task', render: (r) => (
                <div>
                  <div className="cell-primary">{r.taskName}</div>
                  <div className="cell-sub">{r.departmentName} · {r.subDepartmentName}</div>
                </div>
              ) },
              { key: 'category', header: 'Category', render: (r) => r.category || '—' },
              { key: 'emp', header: 'Employee', render: (r) => r.employeeName || '—' },
              { key: 'hours', header: 'Hours (Completed / Allocated)', render: (r) => `${r.completedHours} / ${r.allocatedHours}` },
              { key: 'progress', header: 'Progress', render: (r) => {
                const pct = Math.min(100, Math.round((r.completedHours / r.allocatedHours) * 100));
                return <div style={{ minWidth: 90 }}><ProgressBar pct={pct} color={pct >= 100 ? 'green' : pct >= 70 ? 'accent' : 'amber'} /></div>;
              } },
              { key: 'dueDate', header: 'Due Date', render: (r) => <span className="mono">{r.dueDate || '—'}</span> },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={taskBadgeStatus(r.status)}>{r.status}</StatusBadge> },
            ]}
            rows={tasks}
            onRowClick={canAllocate ? openTaskEdit : undefined}
            emptyTitle="No tasks assigned yet"
            emptySub="Use '+ Assign Task' to add the first task for this project."
          />
        </div>
      </div>

      {canEdit && projectForm && (
        <Drawer
          open={projectEditOpen}
          onClose={() => setProjectEditOpen(false)}
          title="Edit Project"
          subtitle={project.jobCode}
          footer={<>
            <button className="btn" onClick={() => setProjectEditOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveProject} disabled={submitting}>{submitting ? 'Saving…' : 'Save Changes'}</button>
          </>}
        >
          <FormField label="Project name">
            <input className="filter-input" style={{ width: '100%' }} value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} />
          </FormField>
          <FormField label="Client name">
            <input className="filter-input" style={{ width: '100%' }} value={projectForm.clientName} onChange={(e) => setProjectForm({ ...projectForm, clientName: e.target.value })} />
          </FormField>
          <FormField label="Consultant name">
            <input className="filter-input" style={{ width: '100%' }} value={projectForm.consultantName} onChange={(e) => setProjectForm({ ...projectForm, consultantName: e.target.value })} />
          </FormField>
          <FormField label="Main contractor name">
            <input className="filter-input" style={{ width: '100%' }} value={projectForm.mainContractorName} onChange={(e) => setProjectForm({ ...projectForm, mainContractorName: e.target.value })} />
          </FormField>
          <FormField label="MAP contractor name">
            <input className="filter-input" style={{ width: '100%' }} value={projectForm.mapContractorName} onChange={(e) => setProjectForm({ ...projectForm, mapContractorName: e.target.value })} />
          </FormField>
          <div className="grid-2">
            <FormField label="Start date">
              <input type="date" className="filter-input" style={{ width: '100%' }} value={projectForm.startDate} onChange={(e) => setProjectForm({ ...projectForm, startDate: e.target.value })} />
            </FormField>
            <FormField label="Target completion">
              <input type="date" className="filter-input" style={{ width: '100%' }} value={projectForm.targetDate} onChange={(e) => setProjectForm({ ...projectForm, targetDate: e.target.value })} />
            </FormField>
          </div>
          <div className="grid-2">
            <FormField label="Priority">
              <select className="filter-select" style={{ width: '100%' }} value={projectForm.priority} onChange={(e) => setProjectForm({ ...projectForm, priority: e.target.value })}>
                <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
              </select>
            </FormField>
            <FormField label="Status">
              <select className="filter-select" style={{ width: '100%' }} value={projectForm.status} onChange={(e) => setProjectForm({ ...projectForm, status: e.target.value })}>
                <option>Planning</option><option>In Progress</option><option>On Hold</option><option>Completed</option>
              </select>
            </FormField>
          </div>
          <FormField label="Estimated man-hours">
            <input type="number" className="filter-input" style={{ width: '100%' }} value={projectForm.estimatedManHours} onChange={(e) => setProjectForm({ ...projectForm, estimatedManHours: e.target.value })} />
          </FormField>
          <FormField label="Project manager">
            <select className="filter-select" style={{ width: '100%' }} value={projectForm.projectManagerId} onChange={(e) => setProjectForm({ ...projectForm, projectManagerId: e.target.value })}>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </FormField>
          <FormField label="Team leader">
            <select className="filter-select" style={{ width: '100%' }} aria-label="Team leader" value={projectForm.teamLeaderId} onChange={(e) => setProjectForm({ ...projectForm, teamLeaderId: e.target.value })}>
              <option value="">No team leader</option>
              {teamLeaderChoices.map((l) => <option key={l.id} value={l.id}>{l.name}{l.department ? ` — ${l.department}` : ''}</option>)}
            </select>
          </FormField>
          {project.agreedFee !== undefined && (
            <FormField label="Agreed fee">
              <input type="number" min="0" className="filter-input" style={{ width: '100%' }} aria-label="Agreed fee" value={projectForm.agreedFee} onChange={(e) => setProjectForm({ ...projectForm, agreedFee: e.target.value })} placeholder="Optional" />
            </FormField>
          )}
          <FormField label="Project completion (%)">
            <input type="number" min="0" max="100" className="filter-input" style={{ width: '100%' }} aria-label="Project completion" value={projectForm.completionOverridePercent} onChange={(e) => setProjectForm({ ...projectForm, completionOverridePercent: e.target.value })} placeholder="Calculated from completed tasks" />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Enter your own figure, or leave empty to calculate it from the tasks that are completed.</div>
          </FormField>
          <FormField label="Departments involved">
            <div className="pill-row" data-testid="department-pills">
              {allDepartments.map((d) => {
                const selected = projectForm.departmentIds.includes(d.department_id);
                const locked = selected && departmentsWithTasks.has(d.department_id);
                return (
                  <span
                    key={d.department_id}
                    role="button"
                    aria-pressed={selected}
                    aria-disabled={locked}
                    title={locked ? 'This department already has tasks, so it cannot be removed.' : undefined}
                    className={`badge ${selected ? 'badge-blue' : 'badge-grey'}`}
                    style={{ cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.7 : 1 }}
                    onClick={() => { if (!locked) toggleProjectDepartment(d.department_id); }}
                  >
                    {d.name}{locked ? ' (has tasks)' : ''}
                  </span>
                );
              })}
            </div>
          </FormField>
        </Drawer>
      )}

      {canAllocate && taskForm && (
        <Modal
          open={!!editTask}
          onClose={() => setEditTask(null)}
          title="Edit Task"
          footer={<>
            <button className="btn" onClick={() => setEditTask(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveTask} disabled={submitting}>{submitting ? 'Saving…' : 'Save Changes'}</button>
          </>}
        >
          <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            {editTask?.departmentName} · {editTask?.subDepartmentName} · {editTask?.employeeName}
          </div>
          <FormField label="Task name">
            <input className="filter-input" style={{ width: '100%' }} value={taskForm.taskName} onChange={(e) => setTaskForm({ ...taskForm, taskName: e.target.value })} />
          </FormField>
          <FormField label="Category">
            <select className="filter-select" style={{ width: '100%' }} aria-label="Category" value={taskForm.category} onChange={(e) => setTaskForm({ ...taskForm, category: e.target.value })}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
          <FormField label="Assigned to">
            <select className="filter-select" style={{ width: '100%' }} value={taskForm.employeeId} onChange={(e) => setTaskForm({ ...taskForm, employeeId: e.target.value })}>
              {reassignOptions.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.designation}</option>)}
            </select>
            {Number(taskForm.employeeId) !== editTask?.employeeId && (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 5 }}>
                Time already logged stays with {editTask?.employeeName}; new time will be logged by the new assignee.
              </div>
            )}
          </FormField>
          <div className="grid-2">
            <FormField label="Allocated hours">
              <input type="number" className="filter-input" style={{ width: '100%' }} value={taskForm.allocatedHours} onChange={(e) => setTaskForm({ ...taskForm, allocatedHours: e.target.value })} />
            </FormField>
            <FormField label="Due date">
              <input type="date" className="filter-input" style={{ width: '100%' }} value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Status">
            <select className="filter-select" style={{ width: '100%' }} value={taskForm.status} onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value })}>
              {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </FormField>
          <FormField label="Remarks">
            <textarea className="filter-input" style={{ width: '100%', minHeight: 70, fontFamily: 'inherit' }} value={taskForm.remarks} onChange={(e) => setTaskForm({ ...taskForm, remarks: e.target.value })} />
          </FormField>

          <div className="section-title" style={{ marginTop: 6 }}>Time sessions</div>
          {sessionsLoading ? (
            <div className="muted" style={{ fontSize: 12.5 }}>Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5 }}>No time logged yet.</div>
          ) : (
            <div data-testid="session-list">
              {sessions.map((s) => (
                <div className="detail-row" key={s.id} style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12.8 }}>
                      {s.logDate} · {s.isOpen ? 'running' : fmtHours(s.durationMinutes)}
                    </div>
                    <div style={{ marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {s.needsReview && <span className="badge badge-amber">Auto-stopped · needs review</span>}
                      {s.autoStopped && !s.needsReview && <span className="badge badge-grey">Auto-stopped</span>}
                      {s.editedAt && <span className="badge badge-blue">Adjusted by {s.editedByName || 'a manager'}</span>}
                    </div>
                    {s.note && <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{s.note}</div>}
                  </div>
                  {!s.isOpen && (
                    <button className="btn btn-sm" onClick={() => setAdjusting({ ...s, taskName: editTask?.taskName, employeeName: editTask?.employeeName })}>Adjust</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {canAllocate && (
        <AdjustSessionModal session={adjusting} onClose={() => setAdjusting(null)} onSaved={handleSessionSaved} />
      )}

      {canAllocate && (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="Assign Task"
          subtitle={project.name}
          footer={<>
            <button className="btn" onClick={() => setDrawerOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleAssign} disabled={submitting}>{submitting ? 'Assigning…' : 'Assign Task'}</button>
          </>}
        >
          <FormField label="Department">
            <select className="filter-select" style={{ width: '100%' }} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value, subDepartmentId: '', employeeId: '' })}>
              <option value="">Select department...</option>
              {assignableDepartments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
            </select>
            {assignableDepartments.length === 0 && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>There is nobody in this project's departments that you can give work to.</div>
            )}
          </FormField>
          <FormField label="Sub-department">
            <select className="filter-select" style={{ width: '100%' }} value={form.subDepartmentId} onChange={(e) => setForm({ ...form, subDepartmentId: e.target.value })} disabled={!form.departmentId}>
              <option value="">Select sub-department...</option>
              {availableSubDepts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </FormField>
          <FormField label="Task name">
            <input className="filter-input" style={{ width: '100%' }} value={form.taskName} onChange={(e) => setForm({ ...form, taskName: e.target.value })} placeholder="e.g. Pipe stress analysis — Line 14B" />
          </FormField>
          <FormField label="Category">
            <select className="filter-select" style={{ width: '100%' }} aria-label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
          <FormField label="Assign to employee">
            <select className="filter-select" style={{ width: '100%' }} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} disabled={!form.departmentId}>
              <option value="">Select employee...</option>
              {availableEmployees.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.designation}</option>)}
            </select>
          </FormField>
          <div className="grid-2">
            <FormField label="Allocated hours">
              <input type="number" className="filter-input" style={{ width: '100%' }} value={form.allocatedHours} onChange={(e) => setForm({ ...form, allocatedHours: e.target.value })} />
            </FormField>
            <FormField label="Due date">
              <input type="date" className="filter-input" style={{ width: '100%' }} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Remarks (optional)">
            <input className="filter-input" style={{ width: '100%' }} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </FormField>
        </Drawer>
      )}
    </>
  );
}

function MiniStat({ label, value }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18 }}>{value}</div>
    </div>
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
