import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/layout/PageHeader';
import StatCard from '../../components/common/StatCard';
import StatusBadge from '../../components/common/StatusBadge';
import Tabs from '../../components/common/Tabs';
import FormField from '../../components/common/FormField';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import { useApp } from '../../context/AppContext';
import * as systemApi from '../../api/system';

function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

const when = (value) => (value ? new Date(value).toLocaleString() : 'Not yet');

function Health() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      setHealth(await systemApi.getHealth());
    } catch (err) {
      setError(err.message || 'Failed to load system health.');
    }
  }

  useEffect(() => { load(); }, []);

  if (error) return <EmptyState icon="AlertTriangle" title="Couldn't load system health" sub={error} action={<button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button>} />;
  if (!health) return <Loading label="Checking the system…" />;

  const { counts, jobs, database } = health;
  return (
    <>
      <div className="stat-grid">
        <StatCard label="System" value={health.status === 'ok' ? 'Healthy' : 'Needs attention'} accent={health.status === 'ok' ? 'green' : 'red'} foot={`v${health.version} · ${health.environment}`} />
        <StatCard label="Database" value={database.ok ? 'Connected' : 'Down'} accent={database.ok ? 'green' : 'red'} foot={database.ok ? `${database.latencyMs} ms` : database.error} />
        <StatCard label="Uptime" value={fmtUptime(health.uptimeSeconds)} foot={`Node ${health.node}`} />
        <StatCard label="Active People" value={counts.activePeople} foot={`${counts.inactivePeople} inactive`} />
        <StatCard label="Running Timers" value={counts.runningTimers} />
        <StatCard label="Failed Sign-ins Today" value={counts.failedLoginsToday} accent={counts.failedLoginsToday >= 10 ? 'red' : counts.failedLoginsToday ? 'amber' : 'green'} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><div><h3>Background jobs</h3><div className="card-head-sub">Stop forgotten timers and send reminders</div></div></div>
          <div className="card-pad">
            <div className="detail-row"><span className="k">Timer check</span><span className="v">{when(jobs.lastSweepAt)}</span></div>
            <div className="detail-row"><span className="k">Sessions stopped last run</span><span className="v">{jobs.lastSweepStopped}</span></div>
            <div className="detail-row"><span className="k">Reminders and clean-up</span><span className="v">{when(jobs.lastDailyAt)}</span></div>
            {(jobs.lastSweepError || jobs.lastDailyError) && (
              <div role="alert" style={{ color: 'var(--status-red)', fontSize: 12.5, marginTop: 8 }}>
                {jobs.lastSweepError || jobs.lastDailyError}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div><h3>What needs attention</h3></div></div>
          <div className="card-pad">
            <div className="detail-row"><span className="k">Sessions waiting for review</span><span className="v">{counts.unreviewedSessions}</span></div>
            <div className="detail-row"><span className="k">Correction requests pending</span><span className="v">{counts.pendingCorrections}</span></div>
            <div className="detail-row"><span className="k">Changes recorded today</span><span className="v"><Link className="link-btn" to="/audit">{counts.auditEntriesToday}</Link></span></div>
            <div className="detail-row"><span className="k">Active projects / open tasks</span><span className="v">{counts.activeProjects} / {counts.openTasks}</span></div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><div><h3>Accounts by role</h3></div></div>
        <div className="card-pad">
          <div className="pill-row">
            {counts.peopleByRole.map((r) => <StatusBadge key={r.role} severity="blue">{r.label}: {r.count}</StatusBadge>)}
          </div>
        </div>
      </div>
    </>
  );
}

function Settings() {
  const { pushToast } = useApp();
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setError('');
    try {
      const list = await systemApi.listSettings();
      setSettings(list);
      setDraft(Object.fromEntries(list.map((s) => [s.key, String(s.value)])));
    } catch (err) {
      setError(err.message || 'Failed to load settings.');
    }
  }

  useEffect(() => { load(); }, []);

  if (error) return <EmptyState icon="AlertTriangle" title="Couldn't load settings" sub={error} action={<button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button>} />;
  if (!settings) return <Loading label="Loading settings…" />;

  const changed = settings.filter((s) => draft[s.key] !== String(s.value));

  async function save() {
    setFormError('');
    const values = {};
    for (const s of changed) {
      const n = Number(draft[s.key]);
      if (draft[s.key].trim() === '' || !Number.isInteger(n) || n < s.min || n > s.max) {
        setFormError(`${s.label} must be a whole number between ${s.min} and ${s.max} ${s.unit}.`);
        return;
      }
      values[s.key] = n;
    }
    setSaving(true);
    try {
      const result = await systemApi.saveSettings(values);
      setSettings(result.settings);
      setDraft(Object.fromEntries(result.settings.map((s) => [s.key, String(s.value)])));
      pushToast('Settings saved.');
    } catch (err) {
      setFormError(err.message || 'Could not save the settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head"><div><h3>System settings</h3><div className="card-head-sub">Changes apply straight away and are recorded in the audit trail.</div></div></div>
      <div className="card-pad">
        {settings.map((s) => (
          <FormField key={s.key} label={s.label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                className="filter-input"
                style={{ width: 110 }}
                aria-label={s.label}
                min={s.min}
                max={s.max}
                step={s.step}
                value={draft[s.key]}
                onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
              />
              <span className="muted">{s.unit}</span>
              {s.isDefault ? <StatusBadge severity="grey">Default</StatusBadge> : <StatusBadge severity="blue">Changed{s.updatedByName ? ` by ${s.updatedByName}` : ''}</StatusBadge>}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{s.description} Allowed: {s.min}–{s.max} {s.unit}. Default: {s.default}.</div>
          </FormField>
        ))}
        {formError && <div role="alert" style={{ color: 'var(--status-red)', fontSize: 12.5, marginBottom: 10 }}>{formError}</div>}
        <button className="btn btn-primary" onClick={save} disabled={saving || changed.length === 0}>
          {saving ? 'Saving…' : changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// The System Administrator's home: how the system is doing, and its settings.
export default function Admin() {
  const [tab, setTab] = useState('health');
  return (
    <>
      <PageHeader title="Administration" sub="System health and settings" />
      <Tabs items={[{ label: 'System health', value: 'health' }, { label: 'Settings', value: 'settings' }]} active={tab} onChange={setTab} />
      {tab === 'health' ? <Health /> : <Settings />}
    </>
  );
}
