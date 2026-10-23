import React, { useEffect, useState } from 'react';
import PageHeader from '../../components/layout/PageHeader';
import StatCard from '../../components/common/StatCard';
import StatusBadge from '../../components/common/StatusBadge';
import { taskBadgeStatus } from '../../utils/taskStatus';
import ProgressBar from '../../components/common/ProgressBar';
import EmptyState from '../../components/common/EmptyState';
import Loading from '../../components/common/Loading';
import { useAuth } from '../../context/AuthContext';
import * as tasksApi from '../../api/tasks';

export default function MyProgress() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await tasksApi.listMyTasks();
      setTasks(data);
    } catch (err) {
      setError(err.message || 'Failed to load your progress.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <Loading label="Loading your progress…" />;
  if (error) {
    return (
      <EmptyState
        icon="AlertTriangle"
        title="Couldn't load your progress"
        sub={error}
        action={<button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button>}
      />
    );
  }

  const totalAllocated = tasks.reduce((s, t) => s + t.allocatedHours, 0);
  const totalCompleted = tasks.reduce((s, t) => s + t.completedHours, 0);
  const totalRemaining = Math.max(0, totalAllocated - totalCompleted);
  const completedTasks = tasks.filter((t) => t.status === 'Completed').length;

  const byProject = {};
  tasks.forEach((t) => {
    if (!byProject[t.projectId]) byProject[t.projectId] = { name: t.projectName, jobCode: t.projectJobCode, tasks: [] };
    byProject[t.projectId].tasks.push(t);
  });

  return (
    <>
      <PageHeader title="My Progress" sub={`${user.name} · ${user.department || 'Management'}`} />

      <div className="stat-grid">
        <StatCard label="Total Allocated Hours" value={totalAllocated} />
        <StatCard label="Hours Completed" value={totalCompleted} accent="green" />
        <StatCard label="Hours Remaining" value={totalRemaining} accent={totalRemaining > 0 ? 'amber' : 'green'} />
        <StatCard label="Tasks Completed" value={`${completedTasks} / ${tasks.length}`} />
      </div>

      {Object.keys(byProject).length === 0 ? (
        <div className="card"><div className="card-pad"><EmptyState title="No tasks assigned yet" sub="Progress will appear here once tasks are assigned." /></div></div>
      ) : (
        Object.entries(byProject).map(([projectId, proj]) => {
          const allocated = proj.tasks.reduce((s, t) => s + t.allocatedHours, 0);
          const completed = proj.tasks.reduce((s, t) => s + t.completedHours, 0);
          const pct = Math.min(100, Math.round((completed / allocated) * 100));

          return (
            <div className="card" key={projectId} style={{ marginBottom: 16 }}>
              <div className="card-head">
                <div>
                  <h3>{proj.name}</h3>
                  <div className="card-head-sub">{proj.jobCode}</div>
                </div>
                <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{completed} / {allocated}h</span>
              </div>
              <div className="card-pad">
                <ProgressBar pct={pct} color={pct >= 100 ? 'green' : pct >= 70 ? 'accent' : 'amber'} />
                <div className="divider" />
                {proj.tasks.map((t) => {
                  const taskPct = Math.min(100, Math.round((t.completedHours / t.allocatedHours) * 100));
                  const timeLeft = Math.max(0, t.allocatedHours - t.completedHours);
                  return (
                    <div className="detail-row" key={t.id} style={{ alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 12.8 }}>{t.taskName}</div>
                        <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>{t.departmentName} · {t.subDepartmentName}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 120 }}><ProgressBar pct={taskPct} color={taskPct >= 100 ? 'green' : taskPct >= 70 ? 'accent' : 'amber'} /></div>
                          <span className="mono muted" style={{ fontSize: 11 }}>{t.completedHours}h done · {timeLeft}h left</span>
                        </div>
                      </div>
                      <StatusBadge status={taskBadgeStatus(t.status)}>{t.status}</StatusBadge>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
