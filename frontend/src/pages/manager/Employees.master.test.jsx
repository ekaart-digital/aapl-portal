import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Employees from './Employees';
import { person, authOf, hrAdmin, teamLeader } from '../../test/fixtures';

// Overtime eligibility, the photograph and the current project allocation (SRS section 6).
const mocks = vi.hoisted(() => ({
  persona: null,
  listEmployees: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  resetPassword: vi.fn(),
  getPhoto: vi.fn(),
  setPhoto: vi.fn(),
  listDepartments: vi.fn(),
  resize: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock('../../api/employees', () => ({
  listEmployees: mocks.listEmployees,
  createEmployee: mocks.createEmployee,
  updateEmployee: mocks.updateEmployee,
  resetPassword: mocks.resetPassword,
  getPhoto: mocks.getPhoto,
  setPhoto: mocks.setPhoto,
}));
vi.mock('../../api/departments', () => ({ listDepartments: mocks.listDepartments }));
vi.mock('../../utils/image', () => ({ resizeImageToDataUrl: mocks.resize }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => authOf(mocks.persona) }));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));

const PHOTO = 'data:image/jpeg;base64,AAAA';

const people = () => [
  person({ id: 4, name: 'Ahmed Khalil', email: 'ahmed@test.local', role: 'employee', designation: 'Engineer', department: 'Piping', departmentId: 1, overtimeEligible: true, hasPhoto: true, currentProjects: ['Saria Refinery', 'Al Reem'] }),
  person({ id: 8, name: 'Daniel Costa', email: 'daniel@test.local', role: 'employee', designation: 'Engineer', department: 'Structural', departmentId: 2, overtimeEligible: false, hasPhoto: false, currentProjects: [] }),
];

const departments = [
  { department_id: 1, name: 'Piping', subDepartments: [], teams: [] },
  { department_id: 2, name: 'Structural', subDepartments: [], teams: [] },
];

const drawerFor = (title) => screen.getByText(title, { selector: 'h3' }).closest('.drawer-panel');

async function renderPage(persona = hrAdmin) {
  mocks.persona = persona;
  render(<Employees />);
  await screen.findByText('Directory');
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
  mocks.listEmployees.mockResolvedValue(people());
  mocks.listDepartments.mockResolvedValue(departments);
  mocks.getPhoto.mockResolvedValue(PHOTO);
  mocks.setPhoto.mockResolvedValue({ ok: true });
  mocks.resize.mockResolvedValue(PHOTO);
});

describe('overtime eligibility', () => {
  it('can be set when adding someone', async () => {
    mocks.createEmployee.mockResolvedValue(person({ id: 50, name: 'New Person', role: 'employee', overtimeEligible: true }));
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: '+ New Employee' }));
    const drawer = drawerFor('New Employee');
    const inputs = within(drawer).getAllByRole('textbox');
    await userEvent.type(inputs[0], 'New Person');
    await userEvent.type(inputs[1], 'new@test.local');
    await userEvent.type(drawer.querySelector('input[type="password"]'), 'Passw0rd!x');
    await userEvent.selectOptions(within(drawer).getByLabelText('Department for the new employee'), '1');
    await userEvent.click(within(drawer).getByLabelText('Eligible for overtime'));
    await userEvent.click(within(drawer).getByRole('button', { name: /Add Employee|Create/i }));
    await waitFor(() => expect(mocks.createEmployee).toHaveBeenCalledWith(expect.objectContaining({ overtimeEligible: true })));
  });

  it('shows the current setting when editing, and sends a change', async () => {
    mocks.updateEmployee.mockResolvedValue({ ...people()[0], overtimeEligible: false });
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ahmed Khalil' }));
    const drawer = drawerFor('Ahmed Khalil');
    const box = within(drawer).getByLabelText('Eligible for overtime');
    expect(box).toBeChecked();
    await userEvent.click(box);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.updateEmployee).toHaveBeenCalledWith(4, expect.objectContaining({ overtimeEligible: false })));
  });

  it('is shown as text to people who can only look', async () => {
    await renderPage(teamLeader);
    await userEvent.click(screen.getByRole('button', { name: 'View Ahmed Khalil' }));
    expect(within(drawerFor('Ahmed Khalil')).getByText('Eligible')).toBeInTheDocument();
    expect(within(drawerFor('Ahmed Khalil')).queryByLabelText('Eligible for overtime')).not.toBeInTheDocument();
  });
});

describe('photograph', () => {
  it('is fetched and shown for someone who has one', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ahmed Khalil' }));
    expect(mocks.getPhoto).toHaveBeenCalledWith(4);
    const img = await within(drawerFor('Ahmed Khalil')).findByAltText('Photograph of Ahmed Khalil');
    expect(img).toHaveAttribute('src', PHOTO);
    expect(within(drawerFor('Ahmed Khalil')).getByRole('button', { name: 'Remove photograph' })).toBeInTheDocument();
  });

  it('is not fetched for someone without one, who gets an Add button', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Daniel Costa' }));
    expect(mocks.getPhoto).not.toHaveBeenCalled();
    expect(within(drawerFor('Daniel Costa')).getByText('Add photograph')).toBeInTheDocument();
    expect(within(drawerFor('Daniel Costa')).queryByRole('button', { name: 'Remove photograph' })).not.toBeInTheDocument();
  });

  it('is shrunk, saved and shown when a picture is chosen', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Daniel Costa' }));
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    fireEvent.change(within(drawerFor('Daniel Costa')).getByLabelText('Photograph file'), { target: { files: [file] } });
    await waitFor(() => expect(mocks.resize).toHaveBeenCalledWith(file));
    await waitFor(() => expect(mocks.setPhoto).toHaveBeenCalledWith(8, PHOTO));
    expect(await within(drawerFor('Daniel Costa')).findByAltText('Photograph of Daniel Costa')).toBeInTheDocument();
    expect(mocks.pushToast).toHaveBeenCalledWith('Photograph saved.');
  });

  it('is removed on request', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ahmed Khalil' }));
    await within(drawerFor('Ahmed Khalil')).findByAltText('Photograph of Ahmed Khalil');
    await userEvent.click(within(drawerFor('Ahmed Khalil')).getByRole('button', { name: 'Remove photograph' }));
    await waitFor(() => expect(mocks.setPhoto).toHaveBeenCalledWith(4, null));
    await waitFor(() => expect(within(drawerFor('Ahmed Khalil')).queryByAltText('Photograph of Ahmed Khalil')).not.toBeInTheDocument());
    expect(mocks.pushToast).toHaveBeenCalledWith('Photograph removed.');
  });

  it('reports a picture that cannot be used, without changing anything', async () => {
    mocks.resize.mockRejectedValue(new Error('Choose a PNG, JPEG or WebP picture.'));
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Daniel Costa' }));
    fireEvent.change(within(drawerFor('Daniel Costa')).getByLabelText('Photograph file'), { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });
    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('Choose a PNG, JPEG or WebP picture.'));
    expect(mocks.setPhoto).not.toHaveBeenCalled();
  });

  it('reports a refusal from the server', async () => {
    mocks.setPhoto.mockRejectedValue(new Error('That photograph is too large.'));
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Daniel Costa' }));
    fireEvent.change(within(drawerFor('Daniel Costa')).getByLabelText('Photograph file'), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('That photograph is too large.'));
    expect(within(drawerFor('Daniel Costa')).queryByAltText('Photograph of Daniel Costa')).not.toBeInTheDocument();
  });

  it('can be seen, but not changed, by people who can only look', async () => {
    await renderPage(teamLeader);
    await userEvent.click(screen.getByRole('button', { name: 'View Ahmed Khalil' }));
    expect(await within(drawerFor('Ahmed Khalil')).findByAltText('Photograph of Ahmed Khalil')).toBeInTheDocument();
    expect(within(drawerFor('Ahmed Khalil')).queryByLabelText('Photograph file')).not.toBeInTheDocument();
    expect(within(drawerFor('Ahmed Khalil')).queryByRole('button', { name: 'Remove photograph' })).not.toBeInTheDocument();
  });
});

describe('current project allocation', () => {
  it('lists the projects someone is working on, or says none', async () => {
    await renderPage(teamLeader);
    await userEvent.click(screen.getByRole('button', { name: 'View Ahmed Khalil' }));
    expect(within(drawerFor('Ahmed Khalil')).getByText('Saria Refinery, Al Reem')).toBeInTheDocument();
  });

  it('says None for someone with no open work', async () => {
    await renderPage(teamLeader);
    await userEvent.click(screen.getByRole('button', { name: 'View Daniel Costa' }));
    expect(within(drawerFor('Daniel Costa')).getByText('None')).toBeInTheDocument();
  });

  it('is left out entirely when the server did not send it (HR holds no project data)', async () => {
    mocks.listEmployees.mockResolvedValue(people().map(({ currentProjects, ...rest }) => rest));
    await renderPage(hrAdmin);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ahmed Khalil' }));
    expect(within(drawerFor('Ahmed Khalil')).queryByText('Current projects')).not.toBeInTheDocument();
  });
});
