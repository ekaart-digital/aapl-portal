import React, { useEffect, useState } from 'react';
import PageHeader from '../../components/layout/PageHeader';
import Avatar from '../../components/common/Avatar';
import StatusBadge from '../../components/common/StatusBadge';
import { TASK_STATUSES, taskBadgeStatus } from '../../utils/taskStatus';
import { setTimerRunning } from '../../utils/activity';
import ProgressBar from '../../components/common/ProgressBar';
import Icon from '../../components/common/IconMap';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import Modal from '../../components/common/Modal';
import FormField from '../../components/common/FormField';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import * as tasksApi from '../../api/tasks';
import { fmtHours } from '../../utils/formatters';

function fmtElapsed(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

const WARN_BEFORE_LIMIT_MINUTES = 4 * 60;
const DEFAULT_MAX_SESSION_MINUTES = 12 * 60;

export default function MyTasks() {
  const { user } = useAuth();
  const { pushToast } = useApp();

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [runningTaskId, setRunningTaskId] = useState(null);
  const [runningLogId, setRunningLogId] = useState(null);
  const [runningStartedAt, setRunningStartedAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [busyTaskId, setBusyTaskId] = useState(null);
  const [maxSessionMinutes, setMaxSessionMinutes] = useState(DEFAULT_MAX_SESSION_MINUTES);
  const [autoStopped, setAutoStopped] = useState(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [editStatus, setEditStatus] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  // A running timer counts as activity, so it keeps the idle sign-out away, even
  // while this person looks at another page. Signing out clears it.
  useEffect(() => {
    setTimerRunning(Boolean(runningTaskId));
  }, [runningTaskId]);

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [myTasks, sessionInfo] = await Promise.all([tasksApi.listMyTasks(), tasksApi.getMyOpenSession()]);
      const { openSession, autoStoppedSession, maxSessionMinutes: cap } = sessionInfo || {};
      setTasks(myTasks);
      setAutoStopped(autoStoppedSession || null);
      if (cap) setMaxSessionMinutes(cap);
      if (openSession) {
        setRunningTaskId(openSession.taskId);
        setRunningLogId(openSession.id);
        setRunningStartedAt(Date.now() - (openSession.elapsedSeconds || 0) * 1000);
      } else {
        setRunningTaskId(null);
        setRunningLogId(null);
        setRunningStartedAt(null);
      }
    } catch (err) {
      setError(err.message || 'Failed to load your tasks.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  // Elapsed time is derived from the start moment on every tick, so it stays
  // correct even if the browser throttles timers in a background tab.
  useEffect(() => {
    if (!runningStartedAt) {
      setElapsed(0);
      return undefined;
    }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - runningStartedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [runningStartedAt]);

  async function handleStart(task) {
    if (runningTaskId) {
      pushToast('Stop the current task before starting another.');
      return;
    }
    setBusyTaskId(task.id);
    try {
      const timeLog = await tasksApi.startTimer(task.id);
      setRunningTaskId(task.id);
      setRunningLogId(timeLog.id);
      setRunningStartedAt(Date.now() - (timeLog.elapsedSeconds || 0) * 1000);
      if (task.status === 'Not Started') {
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: 'In Progress' } : t)));
      }
      pushToast(`Timer started — ${task.taskName}`);
    } catch (err) {
      pushToast(err.message || 'Failed to start timer.');
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleStop(task) {
    setBusyTaskId(task.id);
    try {
      const timeLog = await tasksApi.stopTimer(task.id, runningLogId);
      setRunningTaskId(null);
      setRunningLogId(null);
      setRunningStartedAt(null);
      if (timeLog.autoStopped) {
        pushToast(`That timer ran past ${fmtHours(maxSessionMinutes)}. ${fmtHours(timeLog.durationMinutes)} was recorded and flagged for your manager to review.`);
      } else {
        pushToast(`Logged ${timeLog.durationMinutes} min on ${task.taskName}.`);
      }
      const refreshed = await tasksApi.listMyTasks();
      setTasks(refreshed);
    } catch (err) {
      pushToast(err.message || 'Failed to stop timer.');
    } finally {
      setBusyTaskId(null);
    }
  }

  function openEdit(task) {
    setEditTask(task);
    setEditStatus(task.status);
    setEditRemarks(task.remarks || '');
  }

  async function handleSaveEdit() {
    setSaving(true);
    try {
      const updated = await tasksApi.updateTask(editTask.id, { status: editStatus, remarks: editRemarks });
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setEditTask(null);
      pushToast(`Updated ${updated.taskName}.`);
    } catch (err) {
      pushToast(err.message || 'Failed to update task.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading label="Loading your tasks…" />;
  if (error) {
    return (
      <EmptyState
        icon="AlertTriangle"
        title="Couldn't load your tasks"
        sub={error}
        action={<button className="btn" style={{ marginTop: 12 }} onClick={loadAll}>Retry</button>}
      />
    );
  }

  const elapsedMinutes = Math.floor(elapsed / 60);
  const runningTask = tasks.find((t) => t.id === runningTaskId);
  const overLimit = Boolean(runningTaskId) && elapsedMinutes >= maxSessionMinutes;
  const nearLimit = Boolean(runningTaskId) && !overLimit && elapsedMinutes >= maxSessionMinutes - WARN_BEFORE_LIMIT_MINUTES;

  const completedCount = tasks.filter((t) => t.status === 'Completed').length;
  const openTasks = tasks.filter((t) => showCompleted || t.status !== 'Completed');

  return (
    <>
      <PageHeader title="My Tasks" sub={`Welcome back, ${user.name.split(' ')[0]}`} />

      {autoStopped && (
        <div className="notice-banner info" role="status">
          <div>
            Your timer on <strong>{autoStopped.taskName}</strong> was left running and was stopped automatically after {fmtHours(maxSessionMinutes)}
            {autoStopped.logDate ? ` (${autoStopped.logDate})` : ''}. {fmtHours(autoStopped.durationMinutes)} was recorded and your manager will review it.
          </div>
          <div className="notice-actions">
            <button className="btn btn-sm" onClick={() => setAutoStopped(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {(nearLimit || overLimit) && (
        <div className={`notice-banner ${overLimit ? 'danger' : ''}`} role="alert">
          <div>
            {overLimit
              ? <>This timer{runningTask ? <> on <strong>{runningTask.taskName}</strong></> : ''} has passed {fmtHours(maxSessionMinutes)}. Only {fmtHours(maxSessionMinutes)} will be recorded, and your manager will be asked to review it. Stop it now.</>
              : <>This timer{runningTask ? <> on <strong>{runningTask.taskName}</strong></> : ''} has been running for {fmtHours(elapsedMinutes)}. Sessions are limited to {fmtHours(maxSessionMinutes)}. If you have finished, stop it now.</>}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-pad" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Avatar name={user.name} size="lg" />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, fontSize: 15.5 }}>{user.name}</div>
            <div className="muted" style={{ fontSize: 12.8 }}>{user.designation} · {user.department || 'Management'} · EMP-{String(user.id).padStart(3, '0')}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Assigned Tasks</h3>
          <label className="card-head-sub" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
            Show completed ({completedCount})
          </label>
        </div>
        <div className="card-pad">
          {openTasks.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No tasks to show right now.</div>}
          {openTasks.map((t) => {
            const isRunning = runningTaskId === t.id;
            const liveHours = isRunning ? Math.round((t.completedHours + elapsed / 3600) * 10) / 10 : t.completedHours;
            const pct = Math.min(100, Math.round((liveHours / t.allocatedHours) * 100));
            const isBusy = busyTaskId === t.id;

            return (
              <div key={t.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.taskName}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {t.projectName} · {t.departmentName} · {t.subDepartmentName}{t.category ? ` · ${t.category}` : ''}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 140 }}><ProgressBar pct={pct} color={pct >= 100 ? 'green' : pct >= 70 ? 'accent' : 'amber'} /></div>
                      <span className="mono muted" style={{ fontSize: 11.5 }}>{liveHours}h / {t.allocatedHours}h</span>
                      <StatusBadge status={taskBadgeStatus(t.status)}>{t.status}</StatusBadge>
                    </div>
                    {t.remarks && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Remarks: {t.remarks}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isRunning && <span className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{fmtElapsed(elapsed)}</span>}
                    <button className="btn btn-sm" onClick={() => openEdit(t)} disabled={isRunning}>Update</button>
                    {!isRunning ? (
                      <button className="btn btn-primary btn-sm" onClick={() => handleStart(t)} disabled={isBusy || !!runningTaskId || t.status === 'Completed'}>
                        <Icon name="Play" size={13} /> Start
                      </button>
                    ) : (
                      <button className="btn btn-sm" style={{ background: 'var(--status-red)', color: '#fff', border: 'none' }} onClick={() => handleStop(t)} disabled={isBusy}>
                        <Icon name="Square" size={13} /> Stop
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal
        open={!!editTask}
        onClose={() => setEditTask(null)}
        title="Update task"
        footer={<>
          <button className="btn" onClick={() => setEditTask(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSaveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>}
      >
        {editTask && (
          <>
            <div style={{ fontWeight: 700, marginBottom: 14 }}>{editTask.taskName}</div>
            <FormField label="Status">
              <select className="filter-select" style={{ width: '100%' }} value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </FormField>
            <FormField label="Remarks">
              <textarea className="filter-input" style={{ width: '100%', minHeight: 80, fontFamily: 'inherit' }} value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} placeholder="e.g. Awaiting client input" />
            </FormField>
          </>
        )}
      </Modal>
    </>
  );
}
