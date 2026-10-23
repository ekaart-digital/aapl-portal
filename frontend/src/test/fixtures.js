import { createRequire } from 'node:module';

// The permission table is read straight from the backend, so these personas
// can never drift from what the server really grants each role.
const nodeRequire = createRequire(import.meta.url);
const { permissionsFor, ROLE_LABELS } = nodeRequire('../../../backend/src/auth/permissions.js');

export function person(over = {}) {
  const role = over.role || 'employee';
  return {
    id: 1, name: 'Test Person', email: 'person@test.local', designation: 'Engineer',
    department: null, departmentId: null, team: null, teamId: null,
    reportsToTeamLeader: null, reportsToDepartmentHead: null,
    dateOfJoining: null, mobileNumber: null, status: 'active',
    ...over,
    role,
    roleLabel: ROLE_LABELS[role],
    permissions: permissionsFor(role),
  };
}

// What useAuth() returns for a signed-in person.
export function authOf(user) {
  return { user, can: (capability) => user.permissions.includes(capability) };
}

export const manager = person({ id: 1, name: 'Manager One', email: 'm1@test.local', role: 'project_manager', designation: 'Project Manager' });
export const employee = person({
  id: 4, name: 'Ahmed Khalil', email: 'ahmed@test.local', role: 'employee',
  designation: 'Sr. Piping Engineer', department: 'Piping', departmentId: 1,
});
export const teamLeader = person({ id: 20, name: 'Hilal Al-Siyabi', role: 'team_leader', department: 'Piping', departmentId: 1, designation: 'Team Leader' });
export const departmentHead = person({ id: 21, name: 'Khalid Al-Rawahi', role: 'department_head', department: 'Piping', departmentId: 1, designation: 'Head of Piping' });
export const hrAdmin = person({ id: 22, name: 'Layan Al-Mahrouqi', role: 'hr_admin', designation: 'HR Officer' });
export const management = person({ id: 23, name: 'Hamad Al-Said', role: 'management', designation: 'Managing Director' });
export const systemAdmin = person({ id: 24, name: 'Platform Administrator', role: 'system_admin', designation: 'System Administrator' });

export const ALL_PERSONAS = { employee, teamLeader, departmentHead, manager, hrAdmin, management, systemAdmin };

export function makeTask(over = {}) {
  return {
    id: 10, projectId: 1, projectName: 'Saria Refinery', projectJobCode: 'T-001',
    departmentId: 1, departmentName: 'Piping', subDepartmentId: 1, subDepartmentName: 'Input Study',
    employeeId: 4, employeeName: 'Ahmed Khalil', taskName: 'Pipe stress analysis',
    allocatedHours: 10, completedHours: 0, dueDate: null, status: 'Not Started', remarks: null,
    ...over,
  };
}

export function makeProject(over = {}) {
  return {
    id: 1, jobCode: 'T-001', name: 'Saria Refinery', clientName: 'Client Co',
    consultantName: 'Consultant', mainContractorName: 'Main', mapContractorName: 'MAP',
    projectManagerId: 1, projectManagerName: 'Manager One',
    startDate: '2026-01-01', targetDate: '2026-12-31', priority: 'High',
    estimatedManHours: 100, completedManHours: 25, status: 'In Progress', taskCount: 1,
    departments: [{ id: 1, name: 'Piping' }],
    permissions: { edit: true, allocate: true },
    ...over,
  };
}
