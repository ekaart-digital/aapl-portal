import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Structure from './Structure';
import { person } from '../../test/fixtures';

const mocks = vi.hoisted(() => ({
  listDepartments: vi.fn(),
  createDepartment: vi.fn(),
  updateDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
  createSubDepartment: vi.fn(),
  updateSubDepartment: vi.fn(),
  deleteSubDepartment: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  listEmployees: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock('../../api/departments', () => ({
  listDepartments: mocks.listDepartments,
  createDepartment: mocks.createDepartment,
  updateDepartment: mocks.updateDepartment,
  deleteDepartment: mocks.deleteDepartment,
  createSubDepartment: mocks.createSubDepartment,
  updateSubDepartment: mocks.updateSubDepartment,
  deleteSubDepartment: mocks.deleteSubDepartment,
}));
vi.mock('../../api/teams', () => ({
  createTeam: mocks.createTeam,
  updateTeam: mocks.updateTeam,
  deleteTeam: mocks.deleteTeam,
}));
vi.mock('../../api/employees', () => ({ listEmployees: mocks.listEmployees }));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));

const people = [
  person({ id: 21, name: 'Khalid Al-Rawahi', role: 'department_head', departmentId: 1 }),
  person({ id: 25, name: 'Maryam Al-Balushi', role: 'department_head', departmentId: 2 }),
  person({ id: 26, name: 'Retired Head', role: 'department_head', departmentId: 1, status: 'inactive' }),
  person({ id: 20, name: 'Hilal Al-Siyabi', role: 'team_leader', departmentId: 1 }),
  person({ id: 27, name: 'Noora Al-Farsi', role: 'team_leader', departmentId: 2 }),
  person({ id: 4, name: 'Ahmed Khalil', role: 'employee', departmentId: 1 }),
];

const departments = () => [
  {
    department_id: 1, name: 'Piping', headId: 21, headName: 'Khalid Al-Rawahi', employeeCount: 6,
    subDepartments: [{ id: 11, name: 'Input Study' }, { id: 12, name: 'Analysis' }],
    teams: [{ id: 5, name: 'Piping Team A', leaderId: 20, leaderName: 'Hilal Al-Siyabi', memberCount: 4 }],
  },
  {
    department_id: 2, name: 'Structural', headId: null, headName: null, employeeCount: 1,
    subDepartments: [], teams: [],
  },
];

const card = (id) => screen.getByTestId(`department-${id}`);
const dialog = () => document.querySelector('.modal-panel');

async function renderPage() {
  render(<Structure />);
  await screen.findByText('Piping Team A');
}

describe('Organisation', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.listDepartments.mockImplementation(async () => departments());
    mocks.listEmployees.mockResolvedValue(people);
    for (const name of ['createDepartment', 'updateDepartment', 'deleteDepartment', 'createSubDepartment', 'updateSubDepartment', 'deleteSubDepartment', 'createTeam', 'updateTeam', 'deleteTeam']) {
      mocks[name].mockResolvedValue({ ok: true });
    }
  });

  it('shows each department with its head, people count, sub-disciplines and teams', async () => {
    await renderPage();
    const piping = within(card(1));
    expect(piping.getByText('6 active people')).toBeInTheDocument();
    expect(piping.getByLabelText('Department head of Piping')).toHaveValue('21');
    expect(piping.getByText('Input Study')).toBeInTheDocument();
    expect(piping.getByText('Analysis')).toBeInTheDocument();
    expect(piping.getByText('Piping Team A')).toBeInTheDocument();
    expect(piping.getByText(/^4 members/)).toBeInTheDocument();
    expect(piping.getByLabelText('Leader of Piping Team A')).toHaveValue('20');

    const structural = within(card(2));
    expect(structural.getByText('1 active person')).toBeInTheDocument();
    expect(structural.getByText('None yet.')).toBeInTheDocument();
    expect(structural.getByText('No teams yet.')).toBeInTheDocument();
    expect(structural.getByLabelText('Department head of Structural')).toHaveValue('');
  });

  it('offers only active department heads, and only team leaders of the same department', async () => {
    await renderPage();
    const heads = within(card(1)).getByLabelText('Department head of Piping');
    expect(within(heads).getAllByRole('option').map((o) => o.textContent)).toEqual(['No head assigned', 'Khalid Al-Rawahi', 'Maryam Al-Balushi']);

    const leaders = within(card(1)).getByLabelText('Leader of Piping Team A');
    expect(within(leaders).getAllByRole('option').map((o) => o.textContent)).toEqual(['No leader', 'Hilal Al-Siyabi']);
  });

  it('keeps the page on screen while it refreshes after a change', async () => {
    await renderPage();
    let release;
    mocks.listDepartments.mockImplementation(() => new Promise((resolve) => { release = () => resolve(departments()); }));
    await userEvent.selectOptions(within(card(2)).getByLabelText('Department head of Structural'), '25');
    await waitFor(() => expect(mocks.updateDepartment).toHaveBeenCalled());
    expect(screen.queryByText(/loading the organisation/i)).not.toBeInTheDocument();
    expect(screen.getByText('Piping Team A')).toBeInTheDocument();
    release();
  });

  it('adds a department and reloads the list', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: '+ New Department' }));
    await userEvent.type(within(dialog()).getByRole('textbox'), 'CFD');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Add department' }));

    await waitFor(() => expect(mocks.createDepartment).toHaveBeenCalledWith('CFD'));
    expect(mocks.pushToast).toHaveBeenCalledWith('Department added.');
    await waitFor(() => expect(mocks.listDepartments).toHaveBeenCalledTimes(2));
    expect(dialog()).toBeNull();
  });

  it('the Add button stays disabled until something is typed, and Enter submits', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: '+ New Department' }));
    const add = within(dialog()).getByRole('button', { name: 'Add department' });
    expect(add).toBeDisabled();
    await userEvent.type(within(dialog()).getByRole('textbox'), '  Hydraulics  {Enter}');
    await waitFor(() => expect(mocks.createDepartment).toHaveBeenCalledWith('Hydraulics'));
  });

  it('renames a department, starting from its current name', async () => {
    await renderPage();
    await userEvent.click(within(card(2)).getByRole('button', { name: 'Rename' }));
    const input = within(dialog()).getByRole('textbox');
    expect(input).toHaveValue('Structural');
    await userEvent.clear(input);
    await userEvent.type(input, 'Structural Engineering');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateDepartment).toHaveBeenCalledWith(2, { name: 'Structural Engineering' }));
  });

  it('assigns and clears a department head', async () => {
    await renderPage();
    await userEvent.selectOptions(within(card(2)).getByLabelText('Department head of Structural'), '25');
    await waitFor(() => expect(mocks.updateDepartment).toHaveBeenCalledWith(2, { headId: 25 }));

    await userEvent.selectOptions(within(card(1)).getByLabelText('Department head of Piping'), '');
    await waitFor(() => expect(mocks.updateDepartment).toHaveBeenLastCalledWith(1, { headId: null }));
  });

  it('asks before removing a department, and says what blocks it when the server refuses', async () => {
    mocks.deleteDepartment.mockRejectedValue(new Error('Piping still has 6 people, 1 teams and 3 tasks. Move or remove them first.'));
    await renderPage();
    await userEvent.click(within(card(1).querySelector('.card-head')).getByRole('button', { name: 'Remove' }));
    expect(within(dialog()).getByText('Remove Piping?', { selector: 'h3' })).toBeInTheDocument();
    expect(mocks.deleteDepartment).not.toHaveBeenCalled();

    await userEvent.click(within(dialog()).getByRole('button', { name: 'Remove department' }));
    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('Piping still has 6 people, 1 teams and 3 tasks. Move or remove them first.'));
    expect(dialog()).not.toBeNull();
  });

  it('cancelling a removal changes nothing', async () => {
    await renderPage();
    await userEvent.click(within(card(1).querySelector('.card-head')).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(mocks.deleteDepartment).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('adds, renames and removes a sub-discipline', async () => {
    await renderPage();
    await userEvent.click(within(card(1)).getByRole('button', { name: '+ Add' }));
    await userEvent.type(within(dialog()).getByRole('textbox'), 'Documentation');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(mocks.createSubDepartment).toHaveBeenCalledWith(1, 'Documentation'));

    await userEvent.click(within(card(1)).getByRole('button', { name: 'Rename Analysis' }));
    const input = within(dialog()).getByRole('textbox');
    expect(input).toHaveValue('Analysis');
    await userEvent.clear(input);
    await userEvent.type(input, 'Stress Analysis');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateSubDepartment).toHaveBeenCalledWith(12, 'Stress Analysis'));

    await userEvent.click(within(card(1)).getByRole('button', { name: 'Remove Input Study' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mocks.deleteSubDepartment).toHaveBeenCalledWith(11));
  });

  it('adds a team to the right department', async () => {
    await renderPage();
    await userEvent.click(within(card(2)).getByRole('button', { name: '+ Add team' }));
    expect(within(dialog()).getByText('New team in Structural', { selector: 'h3' })).toBeInTheDocument();
    await userEvent.type(within(dialog()).getByRole('textbox'), 'Structural Team A');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Add team' }));
    await waitFor(() => expect(mocks.createTeam).toHaveBeenCalledWith({ name: 'Structural Team A', departmentId: 2 }));
  });

  it('changes a team\'s leader, renames it and removes it', async () => {
    await renderPage();
    await userEvent.selectOptions(within(card(1)).getByLabelText('Leader of Piping Team A'), '');
    await waitFor(() => expect(mocks.updateTeam).toHaveBeenCalledWith(5, { leaderId: null }));

    const teamRow = () => within(card(1)).getByText('Piping Team A').closest('.detail-row');
    await userEvent.click(within(teamRow()).getByRole('button', { name: 'Rename' }));
    const input = within(dialog()).getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'Piping Day Team');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateTeam).toHaveBeenCalledWith(5, { name: 'Piping Day Team' }));

    await userEvent.click(within(teamRow()).getByRole('button', { name: 'Remove' }));
    expect(within(dialog()).getByText(/keep their work/i)).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Remove team' }));
    await waitFor(() => expect(mocks.deleteTeam).toHaveBeenCalledWith(5));
  });

  it('shows the server\'s message when a change is refused', async () => {
    mocks.createTeam.mockRejectedValue(new Error('A team named "Piping Team A" already exists in this department.'));
    await renderPage();
    await userEvent.click(within(card(1)).getByRole('button', { name: '+ Add team' }));
    await userEvent.type(within(dialog()).getByRole('textbox'), 'Piping Team A');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Add team' }));
    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('A team named "Piping Team A" already exists in this department.'));
  });

  it('offers a retry when the structure cannot be loaded', async () => {
    mocks.listDepartments.mockRejectedValueOnce(new Error('Could not reach the server.'));
    render(<Structure />);
    expect(await screen.findByText('Could not reach the server.')).toBeInTheDocument();
    mocks.listDepartments.mockImplementation(async () => departments());
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Piping Team A')).toBeInTheDocument();
  });

  it('says so when there are no departments yet', async () => {
    mocks.listDepartments.mockResolvedValue([]);
    render(<Structure />);
    expect(await screen.findByText('No departments yet')).toBeInTheDocument();
  });
});

describe('Organisation: team members', () => {
  const teamPeople = () => [
    ...people,
    person({ id: 40, name: 'Vivek Rao', role: 'employee', departmentId: 1, teamId: 5, designation: 'Piping Engineer' }),
    person({ id: 41, name: 'Noor Abdullah', role: 'employee', departmentId: 1, teamId: 5, designation: 'Jr. Engineer' }),
    person({ id: 42, name: 'Left Company', role: 'employee', departmentId: 1, teamId: 5, status: 'inactive' }),
    person({ id: 43, name: 'Other Team Person', role: 'employee', departmentId: 1, teamId: 99 }),
  ];

  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.listDepartments.mockImplementation(async () => departments());
    mocks.listEmployees.mockResolvedValue(teamPeople().map((p) => (p.id === 20 ? { ...p, teamId: 5, designation: 'Team Leader' } : p)));
  });

  it('shows who is in a team when its member count is opened, and hides them again', async () => {
    await renderPage();
    expect(screen.queryByTestId('team-members-5')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show members of Piping Team A' }));
    const list = within(screen.getByTestId('team-members-5'));
    expect(list.getByText('Vivek Rao')).toBeInTheDocument();
    expect(list.getByText('Piping Engineer')).toBeInTheDocument();
    expect(list.getByText('Noor Abdullah')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Hide members of Piping Team A' }));
    expect(screen.queryByTestId('team-members-5')).not.toBeInTheDocument();
  });

  it('marks the team leader, and lists only active people of that team', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Show members of Piping Team A' }));
    const list = within(screen.getByTestId('team-members-5'));
    const leaderRow = list.getByText('Hilal Al-Siyabi').closest('.detail-row');
    expect(within(leaderRow).getByText('Team leader')).toBeInTheDocument();
    expect(list.queryByText('Left Company')).not.toBeInTheDocument(); // inactive
    expect(list.queryByText('Other Team Person')).not.toBeInTheDocument(); // another team
    expect(list.getAllByText(/^Employee$/)).toHaveLength(2);
  });

  it('says so when a team has no active members', async () => {
    mocks.listEmployees.mockResolvedValue(people);
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Show members of Piping Team A' }));
    expect(within(screen.getByTestId('team-members-5')).getByText(/No active members yet/)).toBeInTheDocument();
  });

  it('keeps a team open after a change refreshes the page', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Show members of Piping Team A' }));
    mocks.updateTeam.mockResolvedValue({ ok: true });
    await userEvent.selectOptions(within(card(1)).getByLabelText('Leader of Piping Team A'), '');
    await waitFor(() => expect(mocks.updateTeam).toHaveBeenCalled());
    expect(await screen.findByTestId('team-members-5')).toBeInTheDocument();
  });
});
