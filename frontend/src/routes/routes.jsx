import React from 'react';
import { createBrowserRouter } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout';
import Login from '../pages/auth/Login';
import { RequireAuth, RequireCapability, RoleLanding } from './RouteGuards';

import Projects from '../pages/manager/Projects';
import ProjectDetail from '../pages/manager/ProjectDetail';
import Employees from '../pages/manager/Employees';
import Structure from '../pages/manager/Structure';
import Reports from '../pages/manager/Reports';
import Dashboard from '../pages/insight/Dashboard';
import ManHours from '../pages/insight/ManHours';
import Exceptions from '../pages/insight/Exceptions';
import Approvals from '../pages/insight/Approvals';
import Audit from '../pages/insight/Audit';
import Summary from '../pages/insight/Summary';
import WorkReport from '../pages/insight/WorkReport';
import Privacy from '../pages/shared/Privacy';
import MyTime from '../pages/employee/MyTime';
import Admin from '../pages/admin/Admin';
import MyTasks from '../pages/employee/MyTasks';
import MyProgress from '../pages/employee/MyProgress';
import Notifications from '../pages/shared/Notifications';

// Each screen is behind the capability the server grants to the roles that
// should see it. The server enforces the same rules; this only keeps people
// out of screens that would show them nothing.
export const routes = [
  { path: '/login', element: <Login /> },
  { path: '/privacy', element: <Privacy /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <RoleLanding /> },
          {
            element: <RequireCapability capability="projects.view" />,
            children: [
              { path: 'projects', element: <Projects /> },
              { path: 'projects/:id', element: <ProjectDetail /> },
            ],
          },
          {
            element: <RequireCapability capability="my-work" />,
            children: [
              { path: 'my-tasks', element: <MyTasks /> },
              { path: 'my-progress', element: <MyProgress /> },
              { path: 'my-report', element: <WorkReport own /> },
            ],
          },
          {
            element: <RequireCapability capability="corrections.request" />,
            children: [{ path: 'my-time', element: <MyTime /> }],
          },
          { path: 'notifications', element: <Notifications /> },
          {
            element: <RequireCapability capability="employees.view" />,
            children: [{ path: 'employees', element: <Employees /> }],
          },
          {
            element: <RequireCapability capability="structure.manage" />,
            children: [{ path: 'structure', element: <Structure /> }],
          },
          {
            element: <RequireCapability capability="reports.view" />,
            children: [
              { path: 'reports', element: <Reports /> },
              { path: 'man-hours', element: <ManHours /> },
              { path: 'summary', element: <Summary /> },
              { path: 'work-report', element: <WorkReport /> },
            ],
          },
          {
            element: <RequireCapability capability="exceptions.view" />,
            children: [{ path: 'exceptions', element: <Exceptions /> }],
          },
          {
            element: <RequireCapability capability="sessions.review" />,
            children: [{ path: 'approvals', element: <Approvals /> }],
          },
          {
            element: <RequireCapability capability="audit.view" />,
            children: [{ path: 'audit', element: <Audit /> }],
          },
          {
            element: <RequireCapability capability="system.health" />,
            children: [{ path: 'admin', element: <Admin /> }],
          },
          {
            element: <RequireCapability capability="dashboard.team" />,
            children: [{ path: 'team', element: <Dashboard /> }],
          },
          {
            element: <RequireCapability capability="dashboard.department" />,
            children: [{ path: 'department', element: <Dashboard /> }],
          },
          {
            element: <RequireCapability capability="dashboard.company" />,
            children: [{ path: 'dashboard', element: <Dashboard /> }],
          },
          { path: '*', element: <RoleLanding /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
