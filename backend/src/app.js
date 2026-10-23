const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth.routes');
const departmentsRoutes = require('./routes/departments.routes');
const subDepartmentsRoutes = require('./routes/subDepartments.routes');
const teamsRoutes = require('./routes/teams.routes');
const employeesRoutes = require('./routes/employees.routes');
const projectsRoutes = require('./routes/projects.routes');
const tasksRoutes = require('./routes/tasks.routes');
const reportsRoutes = require('./routes/reports.routes');
const timelogsRoutes = require('./routes/timelogs.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const correctionsRoutes = require('./routes/corrections.routes');
const auditRoutes = require('./routes/audit.routes');
const systemRoutes = require('./routes/system.routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(helmet());
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
// Large enough for a small photograph (see employees.controller.js); everything else is tiny.
app.use(express.json({ limit: '350kb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many login attempts. Try again in a few minutes.' } },
});

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/departments', departmentsRoutes);
app.use('/api/sub-departments', subDepartmentsRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/time-logs', timelogsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/corrections', correctionsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/system', systemRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
