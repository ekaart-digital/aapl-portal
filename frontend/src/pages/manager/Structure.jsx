import React, { useEffect, useState } from 'react';
import PageHeader from '../../components/layout/PageHeader';
import Modal from '../../components/common/Modal';
import FormField from '../../components/common/FormField';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import { useApp } from '../../context/AppContext';
import * as departmentsApi from '../../api/departments';
import * as teamsApi from '../../api/teams';
import * as employeesApi from '../../api/employees';
import { roleLabel } from '../../auth/roles';

// One dialog handles every "type a name" action (add/rename a department,
// sub-discipline or team) and every "are you sure" action.
const NAME_MODAL = 'name';
const CONFIRM_MODAL = 'confirm';

export default function Structure() {
  const { pushToast } = useApp();
  const [departments, setDepartments] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { kind, title, ..., onSubmit }
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [openTeams, setOpenTeams] = useState(() => new Set()); // teams whose members are shown

  // `quiet` refreshes in the background after a change, without blanking the page.
  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const [depts, emps] = await Promise.all([departmentsApi.listDepartments(), employeesApi.listEmployees()]);
      setDepartments(depts);
      setPeople(emps);
    } catch (err) {
      setError(err.message || 'Failed to load the organisation.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function run(action, success) {
    setBusy(true);
    try {
      await action();
      if (success) pushToast(success);
      setDialog(null);
      await load(true);
    } catch (err) {
      pushToast(err.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  function askName({ title, label, initial = '', submitLabel, onSubmit }) {
    setText(initial);
    setDialog({ kind: NAME_MODAL, title, label, submitLabel, onSubmit });
  }

  function askConfirm({ title, message, confirmLabel, onConfirm }) {
    setDialog({ kind: CONFIRM_MODAL, title, message, confirmLabel, onConfirm });
  }

  const toggleTeam = (id) => setOpenTeams((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // The people in a team, matching the count shown beside it (active people).
  const membersOf = (teamId) => people.filter((p) => p.teamId === teamId && p.status === 'active');

  const headsFor = () => people.filter((p) => p.role === 'department_head' && p.status === 'active');
  const leadersFor = (departmentId) => people.filter((p) => p.role === 'team_leader' && p.status === 'active' && p.departmentId === departmentId);

  if (loading) return <Loading label="Loading the organisation…" />;
  if (error) {
    return (
      <EmptyState
        icon="AlertTriangle"
        title="Couldn't load the organisation"
        sub={error}
        action={<button className="btn" style={{ marginTop: 12 }} onClick={() => load()}>Retry</button>}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Organisation"
        sub="Departments, their heads, sub-disciplines and teams"
        actions={(
          <button
            className="btn btn-primary"
            onClick={() => askName({
              title: 'New department', label: 'Department name', submitLabel: 'Add department',
              onSubmit: (name) => run(() => departmentsApi.createDepartment(name), 'Department added.'),
            })}
          >
            + New Department
          </button>
        )}
      />

      {departments.length === 0 && (
        <div className="card"><div className="card-pad"><EmptyState title="No departments yet" sub="Add the first department to start building the structure." /></div></div>
      )}

      {departments.map((d) => (
        <div className="card" key={d.department_id} style={{ marginBottom: 16 }} data-testid={`department-${d.department_id}`}>
          <div className="card-head">
            <div>
              <h3>{d.name}</h3>
              <div className="card-head-sub">{d.employeeCount} active {d.employeeCount === 1 ? 'person' : 'people'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-sm"
                onClick={() => askName({
                  title: `Rename ${d.name}`, label: 'Department name', initial: d.name, submitLabel: 'Save',
                  onSubmit: (name) => run(() => departmentsApi.updateDepartment(d.department_id, { name }), 'Department renamed.'),
                })}
              >
                Rename
              </button>
              <button
                className="btn btn-sm"
                onClick={() => askConfirm({
                  title: `Remove ${d.name}?`,
                  message: 'A department can only be removed once it has no people, teams or tasks.',
                  confirmLabel: 'Remove department',
                  onConfirm: () => run(() => departmentsApi.deleteDepartment(d.department_id), 'Department removed.'),
                })}
              >
                Remove
              </button>
            </div>
          </div>
          <div className="card-pad">
            <FormField label="Department head">
              <select
                className="filter-select"
                style={{ width: 280 }}
                aria-label={`Department head of ${d.name}`}
                value={d.headId || ''}
                onChange={(e) => run(
                  () => departmentsApi.updateDepartment(d.department_id, { headId: e.target.value ? Number(e.target.value) : null }),
                  'Department head updated.'
                )}
                disabled={busy}
              >
                <option value="">No head assigned</option>
                {headsFor().map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>

            <div className="section-title" style={{ marginTop: 6 }}>Sub-disciplines</div>
            <div className="pill-row" style={{ marginBottom: 10 }}>
              {d.subDepartments.length === 0 && <span className="muted" style={{ fontSize: 12.5 }}>None yet.</span>}
              {d.subDepartments.map((s) => (
                <span className="badge badge-blue" key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <button
                    className="link-btn"
                    style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', cursor: 'pointer' }}
                    aria-label={`Rename ${s.name}`}
                    onClick={() => askName({
                      title: `Rename ${s.name}`, label: 'Sub-discipline name', initial: s.name, submitLabel: 'Save',
                      onSubmit: (name) => run(() => departmentsApi.updateSubDepartment(s.id, name), 'Sub-discipline renamed.'),
                    })}
                  >
                    {s.name}
                  </button>
                  <button
                    style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', cursor: 'pointer' }}
                    aria-label={`Remove ${s.name}`}
                    onClick={() => askConfirm({
                      title: `Remove ${s.name}?`,
                      message: 'It can only be removed while no task uses it.',
                      confirmLabel: 'Remove',
                      onConfirm: () => run(() => departmentsApi.deleteSubDepartment(s.id), 'Sub-discipline removed.'),
                    })}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                className="btn btn-sm"
                onClick={() => askName({
                  title: `Add a sub-discipline to ${d.name}`, label: 'Sub-discipline name', submitLabel: 'Add',
                  onSubmit: (name) => run(() => departmentsApi.createSubDepartment(d.department_id, name), 'Sub-discipline added.'),
                })}
              >
                + Add
              </button>
            </div>

            <div className="section-title">Teams</div>
            {d.teams.length === 0 && <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>No teams yet.</div>}
            {d.teams.map((t) => (
              <React.Fragment key={t.id}>
              <div className="detail-row" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 160 }}>
                  <div className="cell-primary">{t.name}</div>
                  <button
                    className="link-btn cell-sub"
                    style={{ background: 'none', border: 'none', padding: 0 }}
                    aria-expanded={openTeams.has(t.id)}
                    aria-label={`${openTeams.has(t.id) ? 'Hide' : 'Show'} members of ${t.name}`}
                    onClick={() => toggleTeam(t.id)}
                  >
                    {t.memberCount} {t.memberCount === 1 ? 'member' : 'members'} {openTeams.has(t.id) ? '▴' : '▾'}
                  </button>
                </div>
                <select
                  className="filter-select"
                  aria-label={`Leader of ${t.name}`}
                  value={t.leaderId || ''}
                  onChange={(e) => run(
                    () => teamsApi.updateTeam(t.id, { leaderId: e.target.value ? Number(e.target.value) : null }),
                    'Team leader updated.'
                  )}
                  disabled={busy}
                >
                  <option value="">No leader</option>
                  {leadersFor(d.department_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => askName({
                      title: `Rename ${t.name}`, label: 'Team name', initial: t.name, submitLabel: 'Save',
                      onSubmit: (name) => run(() => teamsApi.updateTeam(t.id, { name }), 'Team renamed.'),
                    })}
                  >
                    Rename
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => askConfirm({
                      title: `Remove ${t.name}?`,
                      message: 'Its members stay in the department and keep their work; they just no longer belong to a team.',
                      confirmLabel: 'Remove team',
                      onConfirm: () => run(() => teamsApi.deleteTeam(t.id), 'Team removed.'),
                    })}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {openTeams.has(t.id) && (
                <div data-testid={`team-members-${t.id}`} style={{ margin: '4px 0 12px 16px', padding: '8px 12px', borderLeft: '2px solid var(--line, #e3e6ea)' }}>
                  {membersOf(t.id).length === 0 ? (
                    <div className="muted" style={{ fontSize: 12.5 }}>No active members yet. Add people to this team from the Employees page.</div>
                  ) : membersOf(t.id).map((m) => (
                    <div key={m.id} className="detail-row" style={{ alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div className="cell-primary">{m.name}</div>
                        <div className="cell-sub">{m.designation || '—'}</div>
                      </div>
                      <span className={`badge ${m.id === t.leaderId ? 'badge-blue' : 'badge-grey'}`}>{m.id === t.leaderId ? 'Team leader' : roleLabel(m.role)}</span>
                    </div>
                  ))}
                </div>
              )}
              </React.Fragment>
            ))}
            <button
              className="btn btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => askName({
                title: `New team in ${d.name}`, label: 'Team name', submitLabel: 'Add team',
                onSubmit: (name) => run(() => teamsApi.createTeam({ name, departmentId: d.department_id }), 'Team added.'),
              })}
            >
              + Add team
            </button>
          </div>
        </div>
      ))}

      <Modal
        open={dialog?.kind === NAME_MODAL}
        onClose={() => setDialog(null)}
        title={dialog?.title}
        footer={<>
          <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => dialog.onSubmit(text.trim())} disabled={busy || !text.trim()}>
            {busy ? 'Saving…' : dialog?.submitLabel}
          </button>
        </>}
      >
        <FormField label={dialog?.label}>
          <input
            className="filter-input"
            style={{ width: '100%' }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && text.trim() && !busy) dialog.onSubmit(text.trim()); }}
            autoFocus
          />
        </FormField>
      </Modal>

      <Modal
        open={dialog?.kind === CONFIRM_MODAL}
        onClose={() => setDialog(null)}
        title={dialog?.title}
        footer={<>
          <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => dialog.onConfirm()} disabled={busy}>{busy ? 'Working…' : dialog?.confirmLabel}</button>
        </>}
      >
        <div style={{ fontSize: 13.5 }}>{dialog?.message}</div>
      </Modal>
    </>
  );
}
