import React, { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../components/layout/PageHeader';
import DataTable from '../../components/common/DataTable';
import Avatar from '../../components/common/Avatar';
import SearchInput from '../../components/common/SearchInput';
import StatusBadge from '../../components/common/StatusBadge';
import Drawer from '../../components/common/Drawer';
import Modal from '../../components/common/Modal';
import FormField from '../../components/common/FormField';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import * as employeesApi from '../../api/employees';
import * as departmentsApi from '../../api/departments';
import { resizeImageToDataUrl } from '../../utils/image';
import { featureOn, roleOpen } from '../../auth/rollout';
import {
  ALL_ROLES, HR_ASSIGNABLE_ROLES, DEPARTMENT_ROLES, TEAM_MEMBER_ROLES, ROLE_LABELS, roleLabel,
} from '../../auth/roles';

const emptyCreate = {
  name: '', email: '', password: '', role: 'employee', departmentId: '', teamId: '',
  designation: '', dateOfJoining: '', mobileNumber: '', overtimeEligible: false,
};
const empCode = (id) => `EMP-${String(id).padStart(3, '0')}`;

// Powerful accounts that only a System Administrator may change.
const PROTECTED_ROLES = ['hr_admin', 'management', 'system_admin'];

const toNumberOrUndefined = (v) => (v === '' || v == null ? undefined : Number(v));

export default function Employees() {
  const { user, can } = useAuth();
  const { pushToast } = useApp();
  const canManage = can('employees.manage');
  const canAssignRoles = can('roles.assign');
  const overtimeOn = featureOn(user, 'overtime');
  const photosOn = featureOn(user, 'photos');
  // Only the roles that are open can be chosen.
  const roleChoices = (canAssignRoles ? ALL_ROLES : HR_ASSIGNABLE_ROLES).filter((r) => roleOpen(user, r));

  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);

  const [selected, setSelected] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState(null); // data URL of the selected person's photograph
  const [photoBusy, setPhotoBusy] = useState(false);

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [emps, depts] = await Promise.all([employeesApi.listEmployees(), departmentsApi.listDepartments()]);
      setEmployees(emps);
      setDepartments(depts);
    } catch (err) {
      setError(err.message || 'Failed to load employees.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  const teamsOf = (departmentId) => departments.find((d) => d.department_id === Number(departmentId))?.teams || [];

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    return employees.filter((e) => {
      const matchesSearch = e.name.toLowerCase().includes(q) || empCode(e.id).toLowerCase().includes(q) || (e.email || '').toLowerCase().includes(q);
      const matchesDept = dept === 'All' || (e.department || 'No department') === dept;
      const matchesRole = roleFilter === 'All' || e.role === roleFilter;
      return matchesSearch && matchesDept && matchesRole;
    });
  }, [employees, search, dept, roleFilter]);

  function openEmployee(emp) {
    setSelected(emp);
    setPhoto(null);
    if (emp.hasPhoto) employeesApi.getPhoto(emp.id).then(setPhoto).catch(() => setPhoto(null));
    setEditForm({
      overtimeEligible: Boolean(emp.overtimeEligible),
      name: emp.name,
      email: emp.email || '',
      designation: emp.designation || '',
      departmentId: emp.departmentId || '',
      teamId: emp.teamId || '',
      dateOfJoining: emp.dateOfJoining || '',
      mobileNumber: emp.mobileNumber || '',
      role: emp.role,
      status: emp.status,
    });
  }

  const replaceEmployee = (updated) => setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));

  async function handleCreate() {
    if (!createForm.name || !createForm.email || !createForm.password) {
      pushToast('Name, email and an initial password are required.');
      return;
    }
    if (DEPARTMENT_ROLES.includes(createForm.role) && !createForm.departmentId) {
      pushToast(`Select a department for a ${roleLabel(createForm.role)}.`);
      return;
    }
    setSaving(true);
    try {
      const created = await employeesApi.createEmployee({
        name: createForm.name,
        email: createForm.email,
        password: createForm.password,
        role: createForm.role,
        departmentId: DEPARTMENT_ROLES.includes(createForm.role) ? toNumberOrUndefined(createForm.departmentId) : undefined,
        teamId: TEAM_MEMBER_ROLES.includes(createForm.role) ? toNumberOrUndefined(createForm.teamId) : undefined,
        designation: createForm.designation || undefined,
        dateOfJoining: createForm.dateOfJoining || undefined,
        mobileNumber: createForm.mobileNumber || undefined,
        overtimeEligible: overtimeOn ? (createForm.overtimeEligible || undefined) : undefined,
      });
      setEmployees((prev) => [...prev, created]);
      setCreateOpen(false);
      setCreateForm(emptyCreate);
      pushToast(`${created.name} added. Employee ID: ${empCode(created.id)}`);
    } catch (err) {
      pushToast(err.message || 'Failed to add employee.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!editForm.name) {
      pushToast('Name is required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: editForm.name,
        email: editForm.email,
        designation: editForm.designation,
        dateOfJoining: editForm.dateOfJoining || null,
        mobileNumber: editForm.mobileNumber || null,
        ...(overtimeOn ? { overtimeEligible: editForm.overtimeEligible } : {}),
        status: editForm.status,
      };
      if (editForm.role !== selected.role) payload.role = editForm.role;
      if (DEPARTMENT_ROLES.includes(editForm.role)) {
        if (Number(editForm.departmentId) !== selected.departmentId) payload.departmentId = Number(editForm.departmentId);
        if (TEAM_MEMBER_ROLES.includes(editForm.role)) {
          const team = toNumberOrUndefined(editForm.teamId) ?? null;
          if (team !== selected.teamId || payload.departmentId !== undefined) payload.teamId = team;
        }
      }
      const updated = await employeesApi.updateEmployee(selected.id, payload);
      replaceEmployee(updated);
      setSelected(null);
      pushToast(`${updated.name} updated.`);
    } catch (err) {
      pushToast(err.message || 'Failed to update employee.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoChosen(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = ''; // so choosing the same file again works
    if (!file) return;
    setPhotoBusy(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      await employeesApi.setPhoto(selected.id, dataUrl);
      setPhoto(dataUrl);
      replaceEmployee({ ...selected, hasPhoto: true });
      setSelected((prev) => ({ ...prev, hasPhoto: true }));
      pushToast('Photograph saved.');
    } catch (err) {
      pushToast(err.message || 'Could not save the photograph.');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handlePhotoRemoved() {
    setPhotoBusy(true);
    try {
      await employeesApi.setPhoto(selected.id, null);
      setPhoto(null);
      replaceEmployee({ ...selected, hasPhoto: false });
      setSelected((prev) => ({ ...prev, hasPhoto: false }));
      pushToast('Photograph removed.');
    } catch (err) {
      pushToast(err.message || 'Could not remove the photograph.');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleResetPassword() {
    if (newPassword.length < 8) {
      pushToast('Password must be at least 8 characters, with a letter and a number.');
      return;
    }
    setSaving(true);
    try {
      await employeesApi.resetPassword(selected.id, newPassword);
      setResetOpen(false);
      setNewPassword('');
      pushToast(`Password reset for ${selected.name}.`);
    } catch (err) {
      pushToast(err.message || 'Failed to reset password.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading label="Loading employees…" />;
  if (error) {
    return (
      <EmptyState
        icon="AlertTriangle"
        title="Couldn't load employees"
        sub={error}
        action={<button className="btn" style={{ marginTop: 12 }} onClick={loadAll}>Retry</button>}
      />
    );
  }

  const isProtected = selected && PROTECTED_ROLES.includes(selected.role) && !canAssignRoles;
  const editable = canManage && selected && !isProtected;
  const isSelf = selected?.id === user.id;

  return (
    <>
      <PageHeader
        title="Employees"
        sub={canManage ? 'Employee master: accounts, roles, departments and teams' : 'The people you are responsible for'}
        actions={canManage ? <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>+ New Employee</button> : null}
      />
      <div className="card">
        <div className="card-head">
          <h3>Directory</h3>
          <span className="card-head-sub">{rows.length} of {employees.length} people</span>
        </div>
        <div className="card-pad">
          <div className="filter-bar">
            <SearchInput value={search} onChange={setSearch} placeholder="Search by name, ID or email..." />
            <select className="filter-select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
              <option value="All">All Departments</option>
              <option value="No department">No department</option>
              {departments.map((d) => <option key={d.department_id} value={d.name}>{d.name}</option>)}
            </select>
            <select className="filter-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Role">
              <option value="All">All Roles</option>
              {ALL_ROLES.filter((r) => roleOpen(user, r)).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <DataTable
            columns={[
              { key: 'emp', header: 'Employee', render: (r) => (
                <div className="person-cell">
                  <Avatar name={r.name} />
                  <div>
                    <div className="cell-primary">{r.name}</div>
                    <div className="cell-sub">{empCode(r.id)}</div>
                  </div>
                </div>
              ) },
              { key: 'role', header: 'Role', render: (r) => <StatusBadge status={r.role === 'employee' ? 'Active' : 'On Time'}>{r.roleLabel || roleLabel(r.role)}</StatusBadge> },
              { key: 'designation', header: 'Designation' },
              { key: 'department', header: 'Department', render: (r) => r.department || '—' },
              { key: 'team', header: 'Team', render: (r) => r.team || '—' },
              { key: 'reportsTo', header: 'Reports to', render: (r) => r.reportsToTeamLeader?.name || r.reportsToDepartmentHead?.name || '—' },
              { key: 'email', header: 'Email', render: (r) => <span className="mono" style={{ fontSize: 12 }}>{r.email}</span> },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status === 'active' ? 'Active' : 'Offline'}>{r.status === 'active' ? 'Active' : 'Inactive'}</StatusBadge> },
              { key: 'open', header: '', render: (r) => {
                // Editable when this person manages employees and the account is not one only a System Administrator may change.
                const canEditRow = canManage && !(PROTECTED_ROLES.includes(r.role) && !canAssignRoles);
                const verb = canEditRow ? 'Edit' : 'View';
                return (
                  <button className="btn btn-sm" aria-label={`${verb} ${r.name}`} onClick={(e) => { e.stopPropagation(); openEmployee(r); }}>
                    {verb}
                  </button>
                );
              } },
            ]}
            rows={rows}
            onRowClick={openEmployee}
          />
        </div>
      </div>

      {canManage && (
        <Drawer
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title="New Employee"
          subtitle="The Employee ID is generated automatically"
          footer={<>
            <button className="btn" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>{saving ? 'Adding…' : 'Add Employee'}</button>
          </>}
        >
          <FormField label="Full name">
            <input className="filter-input" style={{ width: '100%' }} value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
          </FormField>
          <FormField label="Email">
            <input type="email" className="filter-input" style={{ width: '100%' }} value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
          </FormField>
          <FormField label="Initial password (8+ characters, a letter and a number)">
            <input type="password" className="filter-input" style={{ width: '100%' }} value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} autoComplete="new-password" />
          </FormField>
          <div className="grid-2">
            <FormField label="Role">
              <select className="filter-select" style={{ width: '100%' }} value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value, departmentId: '', teamId: '' })}>
                {roleChoices.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </FormField>
            <FormField label="Department">
              <select className="filter-select" style={{ width: '100%' }} value={createForm.departmentId} onChange={(e) => setCreateForm({ ...createForm, departmentId: e.target.value, teamId: '' })} disabled={!DEPARTMENT_ROLES.includes(createForm.role)} aria-label="Department for the new employee">
                <option value="">{DEPARTMENT_ROLES.includes(createForm.role) ? 'Select department...' : 'Not applicable'}</option>
                {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
              </select>
            </FormField>
          </div>
          {TEAM_MEMBER_ROLES.includes(createForm.role) && (
            <FormField label="Team (optional)">
              <select className="filter-select" style={{ width: '100%' }} value={createForm.teamId} onChange={(e) => setCreateForm({ ...createForm, teamId: e.target.value })} disabled={!createForm.departmentId} aria-label="Team for the new employee">
                <option value="">No team yet</option>
                {teamsOf(createForm.departmentId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </FormField>
          )}
          <FormField label="Designation">
            <input className="filter-input" style={{ width: '100%' }} value={createForm.designation} onChange={(e) => setCreateForm({ ...createForm, designation: e.target.value })} placeholder="e.g. Piping Engineer" />
          </FormField>
          <div className="grid-2">
            <FormField label="Date of joining">
              <input type="date" className="filter-input" style={{ width: '100%' }} value={createForm.dateOfJoining} onChange={(e) => setCreateForm({ ...createForm, dateOfJoining: e.target.value })} />
            </FormField>
            <FormField label="Mobile number">
              <input className="filter-input" style={{ width: '100%' }} value={createForm.mobileNumber} onChange={(e) => setCreateForm({ ...createForm, mobileNumber: e.target.value })} />
            </FormField>
          </div>
          {overtimeOn && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
              <input type="checkbox" checked={createForm.overtimeEligible} onChange={(e) => setCreateForm({ ...createForm, overtimeEligible: e.target.checked })} />
              Eligible for overtime
            </label>
          )}
        </Drawer>
      )}

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        subtitle={selected ? `${empCode(selected.id)} · ${selected.roleLabel || roleLabel(selected.role)}` : ''}
        footer={editable ? (
          <>
            <button className="btn" onClick={() => setResetOpen(true)}>Reset password</button>
            <button className="btn" onClick={() => setSelected(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
          </>
        ) : <button className="btn" onClick={() => setSelected(null)}>Close</button>}
      >
        {photosOn && selected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            {photo ? (
              <img src={photo} alt={`Photograph of ${selected.name}`} style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <div style={{ transform: 'scale(1.9)', transformOrigin: 'left center', width: 40 }}><Avatar name={selected.name} /></div>
            )}
            {editable && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginLeft: photo ? 0 : 36 }}>
                <label className="btn btn-sm" style={{ cursor: photoBusy ? 'wait' : 'pointer' }}>
                  {photoBusy ? 'Saving…' : photo ? 'Change photograph' : 'Add photograph'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Photograph file" style={{ display: 'none' }} onChange={handlePhotoChosen} disabled={photoBusy} />
                </label>
                {photo && <button className="btn btn-sm" onClick={handlePhotoRemoved} disabled={photoBusy}>Remove photograph</button>}
              </div>
            )}
          </div>
        )}
        {selected && editForm && !editable && (
          <>
            {isProtected && (
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Only a System Administrator can change this account.</div>
            )}
            <div className="detail-row"><span className="k">Email</span><span className="v">{selected.email}</span></div>
            <div className="detail-row"><span className="k">Role</span><span className="v">{selected.roleLabel}</span></div>
            <div className="detail-row"><span className="k">Designation</span><span className="v">{selected.designation || '—'}</span></div>
            <div className="detail-row"><span className="k">Department</span><span className="v">{selected.department || '—'}</span></div>
            <div className="detail-row"><span className="k">Team</span><span className="v">{selected.team || '—'}</span></div>
            <div className="detail-row"><span className="k">Team leader</span><span className="v">{selected.reportsToTeamLeader?.name || '—'}</span></div>
            <div className="detail-row"><span className="k">Department head</span><span className="v">{selected.reportsToDepartmentHead?.name || '—'}</span></div>
            <div className="detail-row"><span className="k">Date of joining</span><span className="v">{selected.dateOfJoining || '—'}</span></div>
            <div className="detail-row"><span className="k">Mobile</span><span className="v">{selected.mobileNumber || '—'}</span></div>
            {overtimeOn && <div className="detail-row"><span className="k">Overtime</span><span className="v">{selected.overtimeEligible ? 'Eligible' : 'Not eligible'}</span></div>}
            {selected.currentProjects && (
              <div className="detail-row"><span className="k">Current projects</span><span className="v">{selected.currentProjects.length ? selected.currentProjects.join(', ') : 'None'}</span></div>
            )}
            <div className="detail-row"><span className="k">Status</span><span className="v">{selected.status === 'active' ? 'Active' : 'Inactive'}</span></div>
          </>
        )}
        {editable && editForm && (
          <>
            <FormField label="Full name">
              <input className="filter-input" style={{ width: '100%' }} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </FormField>
            <FormField label="Email">
              <input type="email" className="filter-input" style={{ width: '100%' }} value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            </FormField>
            <FormField label="Designation">
              <input className="filter-input" style={{ width: '100%' }} value={editForm.designation} onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })} />
            </FormField>
            {canAssignRoles && !isSelf && (
              <FormField label="Role">
                <select className="filter-select" style={{ width: '100%' }} value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })} aria-label="Role">
                  {ALL_ROLES.filter((r) => roleOpen(user, r) || r === selected.role).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </FormField>
            )}
            {DEPARTMENT_ROLES.includes(editForm.role) && (
              <div className="grid-2">
                <FormField label="Department">
                  <select className="filter-select" style={{ width: '100%' }} value={editForm.departmentId} onChange={(e) => setEditForm({ ...editForm, departmentId: e.target.value, teamId: '' })} aria-label="Department">
                    <option value="">Select department...</option>
                    {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
                  </select>
                </FormField>
                {TEAM_MEMBER_ROLES.includes(editForm.role) && (
                  <FormField label="Team">
                    <select className="filter-select" style={{ width: '100%' }} value={editForm.teamId} onChange={(e) => setEditForm({ ...editForm, teamId: e.target.value })} aria-label="Team">
                      <option value="">No team</option>
                      {teamsOf(editForm.departmentId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </FormField>
                )}
              </div>
            )}
            <div className="grid-2">
              <FormField label="Date of joining">
                <input type="date" className="filter-input" style={{ width: '100%' }} value={editForm.dateOfJoining} onChange={(e) => setEditForm({ ...editForm, dateOfJoining: e.target.value })} />
              </FormField>
              <FormField label="Mobile number">
                <input className="filter-input" style={{ width: '100%' }} value={editForm.mobileNumber} onChange={(e) => setEditForm({ ...editForm, mobileNumber: e.target.value })} />
              </FormField>
            </div>
            {overtimeOn && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
                <input type="checkbox" checked={editForm.overtimeEligible} onChange={(e) => setEditForm({ ...editForm, overtimeEligible: e.target.checked })} />
                Eligible for overtime
              </label>
            )}
            <FormField label="Account status">
              <select className="filter-select" style={{ width: '100%' }} value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} disabled={isSelf} aria-label="Account status">
                <option value="active">Active</option>
                <option value="inactive">Inactive (cannot sign in)</option>
              </select>
            </FormField>
            {selected.currentProjects && (
              <div className="detail-row"><span className="k">Current projects</span><span className="v">{selected.currentProjects.length ? selected.currentProjects.join(', ') : 'None'}</span></div>
            )}
          </>
        )}
      </Drawer>

      <Modal
        open={resetOpen}
        onClose={() => { setResetOpen(false); setNewPassword(''); }}
        title={`Reset password${selected ? ` — ${selected.name}` : ''}`}
        footer={<>
          <button className="btn" onClick={() => { setResetOpen(false); setNewPassword(''); }}>Cancel</button>
          <button className="btn btn-primary" onClick={handleResetPassword} disabled={saving}>{saving ? 'Resetting…' : 'Reset password'}</button>
        </>}
      >
        <FormField label="New password (8+ characters, a letter and a number)">
          <input type="password" className="filter-input" style={{ width: '100%' }} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
        </FormField>
      </Modal>
    </>
  );
}
