import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Login from './Login';
import { manager, employee } from '../../test/fixtures';

const auth = vi.hoisted(() => ({ login: vi.fn(), state: { user: null, loading: false } }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ login: auth.login, user: auth.state.user, loading: auth.state.loading }),
}));

function renderLogin(initial = '/login') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/projects" element={<div>Projects page</div>} />
        <Route path="/my-tasks" element={<div>My tasks page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Login page', () => {
  beforeEach(() => {
    auth.login.mockReset();
    auth.state = { user: null, loading: false };
  });

  it('asks for an Employee ID and password, not an email', () => {
    renderLogin();
    expect(screen.getByLabelText('Employee ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it('submits the Employee ID and password as typed', async () => {
    auth.login.mockResolvedValue(employee);
    renderLogin();
    await userEvent.type(screen.getByLabelText('Employee ID'), 'EMP-004');
    await userEvent.type(screen.getByLabelText('Password'), 'Passw0rd!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.login).toHaveBeenCalledWith('EMP-004', 'Passw0rd!');
  });

  it('sends an employee to My Tasks and a manager to Projects', async () => {
    auth.login.mockResolvedValue(employee);
    const first = renderLogin();
    await userEvent.type(screen.getByLabelText('Employee ID'), 'EMP-004');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('My tasks page')).toBeInTheDocument();
    first.unmount();

    auth.login.mockResolvedValue(manager);
    renderLogin();
    await userEvent.type(screen.getByLabelText('Employee ID'), 'EMP-001');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Projects page')).toBeInTheDocument();
  });

  it('shows the server error and stays on the page when login fails', async () => {
    auth.login.mockRejectedValue(new Error('Invalid employee ID or password.'));
    renderLogin();
    await userEvent.type(screen.getByLabelText('Employee ID'), 'EMP-004');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid employee ID or password.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('disables the button while signing in', async () => {
    let finish;
    auth.login.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderLogin();
    await userEvent.type(screen.getByLabelText('Employee ID'), 'EMP-004');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
    finish(employee);
    await waitFor(() => expect(screen.getByText('My tasks page')).toBeInTheDocument());
  });

  it('skips the form when already signed in', () => {
    auth.state = { user: employee, loading: false };
    renderLogin();
    expect(screen.getByText('My tasks page')).toBeInTheDocument();
  });
});
