# AAPL Portal — Version 1 (Project & Task Management)

React + Vite frontend for Version 1 of the AAPL platform, with the seven roles
from the client's requirement specification. Attendance and workstation
monitoring are Version 2. It talks to the API in `../backend`.

## Run it

1. Start the backend (see `../backend/README.md`).
2. Copy `.env.example` to `.env` and set `VITE_API_URL` if the API isn't on
   `http://localhost:4000/api`.
3. ```
   npm install
   npm run dev
   ```
4. Open http://localhost:5173 and sign in with an Employee ID and password. The
   backend README lists a demo account for every role.

`npm run build` makes the production build in `dist/`.

## Roles and screens

The server decides what each role may do and tells the browser, so the screens
below only appear for roles that hold the matching capability. The server
enforces the same rules whatever the browser shows.

| Role | Starts on | Screens |
|---|---|---|
| **Employee** | My Tasks | My Tasks (timer, status, remarks), My Progress, My Time (ask for a correction), My Report, Notifications |
| **Team Leader** | Team Dashboard | the Employee screens, Team Dashboard, Projects (give work to the team), Employees (the team), Man-Hours, Exceptions, Approvals, Reports, Work Report, Summary |
| **Department Head** | Department Dashboard | Department Dashboard, Projects (create and edit those that include the department), Employees, Man-Hours, Exceptions, Approvals, Reports, Work Report, Summary |
| **Project Manager** | Projects | Projects (create, edit, give work, review sessions), Employees, Man-Hours, Exceptions, Approvals, Reports, Work Report, Summary |
| **HR / Admin** | Employees | Employees (add, edit, deactivate, reset password), Organisation (departments, heads, sub-disciplines, teams), Audit Trail |
| **Management** | Company Dashboard | Company Dashboard, Projects, Employees, Man-Hours, Exceptions, Reports, Work Report, Summary, Audit Trail (all read-only) |
| **System Administrator** | Administration | System health and settings, Employees (any role), Organisation, Audit Trail |

Everyone gets notifications (the bell in the header) and can change their own
password from the user menu.

- **Dashboards** show the people, workload, live timers, task status mix,
  at-risk projects and what needs attention for the role's own scope.
- **Man-Hours** shows each project's budget, hours used, remaining, work done,
  projected final hours and RED/AMBER/GREEN risk, with a breakdown by person,
  task type and department.
- **Exceptions** lists overdue and over-allocated tasks, waiting or held work,
  man-hour overruns, late projects and sessions awaiting review, most urgent
  first.
- **My Time / Approvals** let an employee ask for a logged session to be
  credited differently; the people who review their time approve or decline,
  and approving applies the change with the full who/when/why trail.
- **Reports and summaries:** Reports (project, team, department and employee
  work-time, with filters), Work Report (one person's day, week or month, with
  project and category distribution and task status; employees open their own as
  My Report), and Summary (the end-of-day, weekly and monthly summary with a
  daily trend, projects nearing budget and major exceptions). Reports, Work
  Report and Summary export to PDF, Excel and CSV; Man-Hours and the Audit Trail
  to Excel and CSV; Exceptions to CSV.
- **Project and people records:** projects carry a team leader, an agreed fee
  (shown only to those who run projects, and Management), and an optional
  completion figure entered by the project manager instead of the calculated
  one. Tasks carry a category. Employee records include a photograph, overtime
  eligibility and the projects someone currently works on.
- **Privacy:** "Privacy and data use" (user menu, and linked from the sign-in
  page) explains what the platform records and why. It is draft wording for the
  company to confirm.
- **Idle sign-out:** people are signed out after the idle time set by the System
  Administrator, but never while a work timer is running.

## Tests

```
npm test
```

Vitest + Testing Library. Covers the API client, route guards, the navigation
for every role (read from the backend's own permission table, so it cannot drift
from what the server grants), login, the timer, projects, employees,
organisation, dashboards, man-hours, exceptions, corrections and approvals, the
audit trail, administration and the idle sign-out. The tests mock the API, so
they need no backend or database.

## Notes

- Notifications are real: the bell polls the unread count every 30 seconds while
  the tab is visible, and `/notifications` is the full inbox.
- `src/data/navConfig.js` is the sidebar, driven by capabilities; routes and
  their guards are in `src/routes/routes.jsx`.
