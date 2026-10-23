# AAPL Platform API — Version 1

Node.js/Express + MySQL backend for project and task management, with the seven
roles from the client's requirement specification (section 34). Attendance and
workstation monitoring are Version 2 and are not part of this system.

Completed hours are never stored: they are always computed as
`SUM(time_logs.duration_minutes)`.

## Setup

1. Create a database and an app user in MySQL:
   ```sql
   CREATE DATABASE aapl_platform CHARACTER SET utf8mb4;
   CREATE USER 'aapl_app'@'%' IDENTIFIED BY 'change_me';
   GRANT ALL PRIVILEGES ON aapl_platform.* TO 'aapl_app'@'%';
   ```
2. Copy `.env.example` to `.env` and fill in your DB credentials and a real
   `JWT_SECRET` (a long random string; the server refuses to start in
   production with a weak one).
3. Install, create the tables and add demo data:
   ```
   npm install
   mysql -u root -p aapl_platform < schema.sql     # a fresh database: the full, current schema
   npm run seed                                     # demo people, projects and tasks
   ```
   `npm run seed` creates every role (including the Team Leaders, Department
   Heads, HR, Management and System Administrator accounts) and one team per
   department. All demo accounts use the password `Passw0rd!`.
4. Start the API: `npm run dev` (listens on `http://localhost:4000`).

### Upgrading an existing database

```
npm run migrate
```

Applies every script in `scripts/migrations/` that has not run yet and records
it in the `schema_migrations` table, so it is safe to run on every deployment.
Current migrations: `001` roles, teams and department heads; `002` the extra task
statuses; `003` correction requests and the audit trail; `004` system settings;
`005` task categories, project master fields (team leader, agreed fee, own
completion figure) and employee photograph and overtime eligibility.

A database that was seeded before the extra roles existed can add the demo
accounts for them with `node scripts/seed-roles.js` (safe to re-run).

## Demo accounts

Sign in with the Employee ID and the password `Passw0rd!`.

| Role | Example | Lands on |
|---|---|---|
| Employee | `EMP-004` Ahmed Khalil | My Tasks |
| Team Leader | `EMP-026` Hilal Al-Siyabi | Team Dashboard |
| Department Head | `EMP-025` Khalid Al-Rawahi | Department Dashboard |
| Project Manager | `EMP-001` Salim Al-Busaidi | Projects |
| HR / Admin | `EMP-035` Layan Al-Mahrouqi | Employees |
| Management | `EMP-036` Hamad Al-Said | Company Dashboard |
| System Administrator | `EMP-037` Platform Administrator | Administration |

The development database also has one test account per role, all with the same
password: `testemployee` `EMP-038`, `testteamleader` `EMP-039`,
`testdepartmenthead` `EMP-040`, `testprojectmanager` `EMP-041`, `testhradmin`
`EMP-042`, `testmanagement` `EMP-043`, `testsystemadmin` `EMP-044`.

Change these passwords before the system is used for real.

## Tests

```
npm test
```

Runs the API test suite (Node's built-in runner, no extra dependencies) against
a **separate** database, `aapl_platform_test`, on the same MySQL server as
`.env` points to. It creates that database if needed, rebuilds the schema and
seeds small fixtures for every role, so it never touches real data (it refuses
to run against any database whose name does not end in `_test`). The DB user
needs permission to create databases.

## Roles and what they can do

One role per account. What a role may do is decided in one place,
`src/auth/permissions.js` (capabilities, which the browser is also sent); which
rows it may see is decided in `src/auth/scope.js`.

| Role | Sees | Can do |
|---|---|---|
| **Employee** | their own tasks and the projects those belong to | run the timer, update the status and remarks of their own tasks, ask for a time correction |
| **Team Leader** | their team (people, tasks, time) and the projects of their department | everything an Employee does, give work to their team and themselves, review their team's time, Team Dashboard |
| **Department Head** | their department(s): people, tasks, projects | create and edit projects that include their department, give work to their department's people, review time, Department Dashboard |
| **Project Manager** | the projects they manage | create and edit those projects, give work to anyone in the project's departments, review time, man-hour dashboard |
| **HR / Admin** | people only, no project or task data | create and edit Employees, Team Leaders, Department Heads and Project Managers, reset passwords, departments, sub-disciplines and teams, read the people part of the audit trail |
| **Management** | everything, read-only | company dashboard, man-hours, exceptions, reports, the whole audit trail |
| **System Administrator** | people only | all HR/Admin powers plus changing roles and the protected accounts (HR, Management, System Administrator), system settings, system health |

Rules worth knowing:

- Nobody sets the scope (name, hours, due date, assignee) of their own work, and
  nobody signs off their own time: a Team Leader's correction goes to the
  Department Head or the project's manager.
- A Project Manager can be a Project Manager or a Department Head.
- HR/Admin cannot create or change HR, Management or System Administrator
  accounts, and nobody can change their own role or deactivate themselves. The
  last active System Administrator cannot be removed.
- Deactivating someone, moving them to another department, or changing their
  role is refused while they hold open tasks or manage active projects.

## Endpoints

All paths are under `/api`. Everything except login needs
`Authorization: Bearer <token>`. A request outside a role's capability is a
`403`; asking for something outside its scope is a `404` or `403`, never data.

### Account

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/auth/login` | anyone | `employeeId` (`EMP-004`, `4` or `004`) and `password`; rate limited. Returns `token` and `user` (with `permissions`, `landing`, `sessionTimeoutMinutes`) |
| GET | `/auth/me` | any | |
| POST | `/auth/change-password` | any | `currentPassword`, `newPassword` (policy below) |

Passwords need at least 8 characters including a letter and a digit (and fit
within bcrypt's 72-byte limit).

### People and structure

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/employees` | Team Leader, Department Head, Project Manager, HR, Management, SysAdmin | limited to the people in the caller's scope |
| GET | `/employees/:id` | yourself or anyone in scope | includes team and reporting lines, overtime eligibility, and (for roles that see projects) the projects they currently work on |
| GET/PUT | `/employees/:id/photo` | GET: yourself or anyone in scope; PUT: HR, SysAdmin | a small PNG, JPEG or WebP as a data URL (about 180 KB at most), or `null` to remove it. Photographs are never included in the lists |
| POST | `/employees` | HR, SysAdmin | HR may create the four operational roles; SysAdmin any |
| PATCH | `/employees/:id` | HR, SysAdmin | profile, `overtimeEligible`, department, team, status; `role` is SysAdmin only |
| PATCH | `/employees/:id/password` | HR, SysAdmin | |
| GET | `/departments` | any | departments with head, sub-disciplines, teams and counts |
| POST/PATCH/DELETE | `/departments`, `/departments/:id` | HR, SysAdmin | a department can be removed only when empty |
| POST | `/departments/:id/sub-departments` | HR, SysAdmin | |
| PATCH/DELETE | `/sub-departments/:id` | HR, SysAdmin | removal refused while a task uses it |
| GET | `/teams` | with `employees.view` | the caller's own teams |
| POST/PATCH/DELETE | `/teams`, `/teams/:id` | HR, SysAdmin | a team leader must be an active Team Leader of the same department |

### Projects, tasks and time

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/projects` | any with project access | scoped list |
| GET | `/projects/project-managers` | creators | who can be named project manager |
| GET | `/projects/team-leaders` | creators | active Team Leaders, to name one on a project |
| POST | `/projects` | Project Manager, Department Head | |
| GET | `/projects/:id` | in scope | includes `permissions: { edit, allocate }`, the team leader, completion % (and whether the manager set it), projected final man-hours, risk, and `assignedEmployees` with planned and used hours. `agreedFee` is sent only to Project Managers, Department Heads and Management |
| PATCH | `/projects/:id` | the project's manager or an involved Department Head | including `projectManagerId`, `departmentIds`, and the optional `teamLeaderId`, `agreedFee` and `completionOverridePercent` (each may be `null` to clear it) |
| GET | `/projects/:projectId/tasks` | in scope | employees see only their own tasks |
| GET | `/projects/:projectId/assignees` | allocators | exactly who the caller may give work to here |
| POST | `/projects/:projectId/tasks` | Project Manager, Department Head, Team Leader | optional `category` |
| GET | `/tasks/categories` | with project access | the task categories (Calculation, Modelling, Drawing, Report preparation, Review, QC, Coordination, Client meeting, Internal meeting, Research, Site work, Administration) |
| GET | `/tasks/mine`, `/tasks/my-open-session` | Employee, Team Leader | |
| GET/PATCH | `/tasks/:id` | in scope | the owner changes status and remarks; whoever allocates the work changes its scope, `category`, and can reassign. Finishing a task records when |
| GET | `/tasks/:id/time-logs` | in scope | |
| POST | `/tasks/:id/time-logs/start`, `.../:logId/stop` | the task's owner | one open timer per person |
| GET | `/time-logs/flagged` | reviewers | auto-stopped sessions nobody has reviewed |
| PATCH | `/time-logs/:logId` | reviewers | `durationMinutes` (0 voids it) and a required `note` |

Task statuses: Not Started, In Progress, Partially Completed, Awaiting Input, On
Hold, Completed. Everything except Completed is open work, which carries over
day to day until it is finished.

### Corrections

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/corrections/sessions` | Employee, Team Leader | my finished sessions in the correction window |
| GET | `/corrections/mine` | Employee, Team Leader | my requests and their decisions |
| POST | `/corrections` | Employee, Team Leader | `logId`, `durationMinutes`, `reason` |
| GET | `/corrections?status=pending\|all` | reviewers | requests from the people they review |
| POST | `/corrections/:id/approve` | reviewers | applies the change with the full who/when/why trail; refused if the session changed since the request |
| POST | `/corrections/:id/reject` | reviewers | a note is required |

### Dashboards, exceptions and reports

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/dashboard` | Team Leader, Department Head, Management | team, department or company view, chosen by role |
| GET | `/dashboard/projects` | with `reports.view` | man-hour health: budget, consumed, remaining, completion, projected final, RED/AMBER/GREEN |
| GET | `/dashboard/projects/:projectId` | with `reports.view` | hours by person, task type, category and department |
| GET | `/dashboard/exceptions` | with `exceptions.view` | overdue and over-allocated tasks, waiting or held work, people with no open work (Team Leaders, Department Heads, Management), man-hour overruns, projects past their target date, sessions awaiting review. Filters: `severity`, `type` |
| GET | `/reports/projects` | with `reports.view` | |
| GET | `/reports/employee-work-time` | with `reports.view` | `from`, `to`, `projectId`, `departmentId`, `teamId` (the team and department reports) |
| GET | `/reports/employee/:id?period=day\|week\|month&date=YYYY-MM-DD` | yourself, or with `reports.view` for people in scope | one person's hours by project and category, a daily series, task status, tasks finished and planned open hours. Weeks run Monday to Sunday |
| GET | `/reports/summary?period=day\|week\|month&date=YYYY-MM-DD` | with `reports.view` | the end-of-day, weekly and monthly summary: hours by project, department, person and category, daily trend, people with no hours, tasks finished, overdue tasks, projects nearing budget and major exceptions |
| GET | `/reports/monthly?month=YYYY-MM` | with `reports.view` | hours by project, department and person for one month |

Man-hour risk is RED once the estimate is used up, the project is projected to
finish well above it, or it is past its target date; AMBER from the warning
level or when it is on course to exceed the estimate. The two levels are
settings.

### Audit trail, administration and notifications

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/audit` | HR, Management, SysAdmin | filters `entityType`, `action` (prefix), `actorId`, `q`, `from`, `to`, `limit`, `offset`. Each role reads only its own part of the trail |
| GET/PATCH | `/system/settings` | SysAdmin | validated against each setting's range |
| GET | `/system/health` | SysAdmin | database, background jobs, counts by role |
| GET | `/notifications` | any | your inbox; `?limit`, `?before`, `?unread=1` |
| GET | `/notifications/unread-count`, PATCH `/notifications/:id/read`, POST `/notifications/read-all` | any | |

## Audit trail

Every change to people, roles, structure, projects, tasks, logged hours,
corrections and settings is recorded with who made it, when, and the old and
new values. Sign-ins, failed sign-ins and password changes are recorded too
(never the passwords). Timers the system stops are recorded against "System".
The actor's name and role are copied into each entry so it stays readable if
they change later. Management reads everything; HR reads the people and structure
part; the System Administrator reads sign-ins, people, structure and settings.
A failure to write an entry is logged without undoing the change.

## System settings

Changed by the System Administrator from the Administration screen, applied
immediately, and recorded in the audit trail:

| Setting | Default | Meaning |
|---|---|---|
| Longest timer session | 12 hours (`MAX_SESSION_HOURS`) | longer sessions are stopped and credited only this much |
| Man-hour warning level | 80% | a project turns AMBER and its manager is warned |
| Man-hour limit | 100% | a project turns RED and managers are alerted |
| Correction request window | 14 days | how far back an employee may ask for a correction |
| Email notifications | 2 | which notifications are also emailed (when email is set up): 0 none, 1 all, 2 attention and critical, 3 critical only |
| Daily summary time | 18 | from this hour the daily summary is sent, and on Fridays the weekly one |
| Idle sign-out | 60 minutes | the browser signs people out after this long idle (never while a work timer is running) |

A saved value wins, then the environment variable (where one exists), then the
default.

## Notifications

Each person has their own inbox. The server creates them when something
happens; the client never does.

| Event | Who is told |
|---|---|
| A task is assigned or reassigned | the new assignee; on reassignment also the previous one |
| An employee puts a task on hold, marks it Awaiting Input, or completes it | the project manager and the employee's Team Leader |
| A manager changes a task's status | the assignee |
| A project is created for, or handed to, someone | the new project manager (and the previous one) |
| A project reaches the warning level | the project manager |
| A project uses up its estimate | the project manager, the Department Heads of its departments and Management |
| A forgotten timer is stopped automatically | the employee, the project manager, Team Leader and Department Head |
| A reviewer adjusts a logged session | the employee, with the old and new time and the reason |
| An employee asks for a time correction | the people who can decide it (never the requester) |
| A correction is approved or declined | the employee, with the reviewer's note |
| A task is due within 2 days, or went overdue in the last 3 days | the assignee (and the project manager and Team Leader when overdue) |
| End of day, from the summary hour | Team Leaders, Department Heads and Management: hours logged, overdue tasks, projects at risk and exceptions for their own scope |
| Fridays, from the summary hour | Department Heads and Management: the weekly summary |

Nobody is notified about their own action. Each event carries a dedupe key, so a
repeated trigger or two server sweeps never produce duplicates, and a failure to
create a notification never breaks the action that caused it. Read notifications
are deleted after 90 days. Due-date alerts and clean-up run hourly.

## Email

Every notification is also created in the app. To send email copies as well, set
`SMTP_HOST` (and the other `SMTP_*`, `MAIL_FROM` and `APP_URL` values in
`.env.example`) and restart. Which notifications are emailed depends on the
"Email notifications" setting. Email is optional: with no `SMTP_HOST` nothing is
sent and nothing else changes, and a failure to send never affects the action
that caused it. Only active people are emailed.

## Backups, HTTPS and deployment notes

- **Backups:** `npm run backup` writes a compressed `mysqldump` of the database to
  `./backups` (or `BACKUP_DIR`) and removes backups older than
  `BACKUP_RETENTION_DAYS` (default 30). It needs the MySQL client tools
  (`mysqldump`) on the PATH. Schedule it daily with cron or Windows Task
  Scheduler. Managed MySQL services such as DigitalOcean also keep their own
  backups; this is an extra, portable copy you control.
- **Restore:** create an empty database, then
  `gunzip -c backups/<file>.sql.gz | mysql -h <host> -u <user> -p <database>`
  (on Windows, decompress with 7-Zip first and use `mysql ... < file.sql`). Test a
  restore on a spare database before you need one.
- **HTTPS:** run the API behind a reverse proxy (Nginx, Caddy, or the hosting
  platform's load balancer) that terminates TLS, and serve the built frontend
  (`npm run build`, then the `dist` folder) from the same HTTPS site. Set
  `CORS_ORIGIN` to that address, `NODE_ENV=production`, and a strong `JWT_SECRET`.
- **Retention:** project hours and the audit trail are kept; read notifications
  are deleted after 90 days.

## Forgotten timers

A session is credited at most the longest-session setting (default 12 hours),
enforced three ways so it does not depend on any one of them running:

- **On stop:** stopping a session past the limit credits exactly the limit and
  flags it for review.
- **Lazily:** starting a timer, loading `my-open-session`, the review queue,
  the dashboards and the reports first close stale sessions, so a forgotten
  timer never blocks new work and hours are never understated.
- **On a schedule:** the server also sweeps every 5 minutes.

Flagged sessions stay in the review queue until a reviewer keeps or corrects
them. Employees can also ask for a correction themselves (see Corrections).

## Design notes

- **Completed hours are never stored**, only summed from `time_logs`. A running
  session contributes 0 until it is stopped.
- **One open timer per employee**, checked when starting (MySQL cannot express
  "only one row where `end_time IS NULL`" without a generated-column workaround).
- **Task assignment** is validated server-side: the sub-discipline must belong to
  one of the project's departments, the person must belong to that department
  and be someone the caller may allocate to.
- **`project_departments` is many-to-many**: a project can span departments.
- **Scope is enforced in SQL**, not by filtering results in code, and every role
  and endpoint pairing is covered by tests (`tests/authorization.test.js`,
  `tests/scope.test.js`).

## What is not in Version 1

Attendance, the attendance machine, and employee workstation monitoring (SRS
version 2). The schema leaves room for them as new tables in a later migration.
