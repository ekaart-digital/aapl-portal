import React, { useEffect, useState } from 'react';
import PageHeader from '../../components/layout/PageHeader';
import DataTable from '../../components/common/DataTable';
import StatusBadge from '../../components/common/StatusBadge';
import Modal from '../../components/common/Modal';
import FormField from '../../components/common/FormField';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import { useApp } from '../../context/AppContext';
import * as correctionsApi from '../../api/corrections';
import { fmtHours } from '../../utils/formatters';

const REQUEST_BADGE = { pending: 'amber', approved: 'green', rejected: 'red' };
const REQUEST_LABEL = { pending: 'Waiting for a decision', approved: 'Approved', rejected: 'Not approved' };

// "My Time": the sessions I logged recently, and a way to ask for one to be
// credited differently when I forgot to stop a timer or started it by mistake.
export default function MyTime() {
  const { pushToast } = useApp();
  const [sessions, setSessions] = useState([]);
  const [requests, setRequests] = useState([]);
  const [windowDays, setWindowDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [target, setTarget] = useState(null);
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('0');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [mine, reqs] = await Promise.all([correctionsApi.listMySessions(), correctionsApi.listMyRequests()]);
      setSessions(mine.sessions);
      setWindowDays(mine.windowDays);
      setRequests(reqs);
    } catch (err) {
      setError(err.message || 'Failed to load your time.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openRequest(session) {
    setTarget(session);
    setHours(String(Math.floor(session.durationMinutes / 60)));
    setMinutes(String(session.durationMinutes % 60));
    setReason('');
    setFormError('');
  }

  async function submit() {
    const h = Number(hours);
    const m = Number(minutes);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59) {
      setFormError('Enter the time as whole hours and minutes (minutes 0 to 59).');
      return;
    }
    const total = h * 60 + m;
    if (total > 24 * 60) { setFormError('A session cannot be longer than 24 hours.'); return; }
    if (total === target.durationMinutes) { setFormError('That is the time already recorded.'); return; }
    if (reason.trim().length < 3) { setFormError('Tell your manager why the time should change.'); return; }

    setSaving(true);
    setFormError('');
    try {
      await correctionsApi.requestCorrection({ logId: target.id, durationMinutes: total, reason: reason.trim() });
      pushToast('Request sent. Your manager will decide on it.');
      setTarget(null);
      await load();
    } catch (err) {
      setFormError(err.message || 'Could not send the request.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading label="Loading your time…" />;
  if (error) {
    return <EmptyState icon="AlertTriangle" title="Couldn't load your time" sub={error} action={<button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button>} />;
  }

  const sessionColumns = [
    { key: 'logDate', header: 'Date', className: 'mono', render: (r) => String(r.logDate).slice(0, 10) },
    {
      key: 'task',
      header: 'Task',
      render: (r) => (
        <>
          <div className="cell-primary">{r.taskName}</div>
          <div className="cell-sub">{r.projectJobCode} · {r.projectName}</div>
        </>
      ),
    },
    { key: 'duration', header: 'Recorded', className: 'mono', render: (r) => fmtHours(r.durationMinutes) },
    {
      key: 'flags',
      header: '',
      render: (r) => (
        <div className="pill-row">
          {r.autoStopped && <StatusBadge severity="amber">Stopped automatically</StatusBadge>}
          {r.adjusted && <StatusBadge severity="blue">Adjusted</StatusBadge>}
          {r.requestStatus && <StatusBadge severity={REQUEST_BADGE[r.requestStatus]}>{REQUEST_LABEL[r.requestStatus]}</StatusBadge>}
        </div>
      ),
    },
    {
      key: 'action',
      header: '',
      render: (r) => (
        <button className="btn btn-sm" onClick={() => openRequest(r)} disabled={r.requestStatus === 'pending'}>
          Request correction
        </button>
      ),
    },
  ];

  const requestColumns = [
    { key: 'createdAt', header: 'Asked', className: 'mono', render: (r) => String(r.createdAt).slice(0, 10) },
    {
      key: 'task',
      header: 'Task',
      render: (r) => (
        <>
          <div className="cell-primary">{r.taskName}</div>
          <div className="cell-sub">{r.projectName} · {String(r.logDate).slice(0, 10)}</div>
        </>
      ),
    },
    { key: 'change', header: 'Change', className: 'mono', render: (r) => `${fmtHours(r.originalMinutes)} → ${fmtHours(r.requestedMinutes)}` },
    { key: 'reason', header: 'Your reason', render: (r) => r.reason },
    {
      key: 'status',
      header: 'Decision',
      render: (r) => (
        <>
          <StatusBadge severity={REQUEST_BADGE[r.status]}>{REQUEST_LABEL[r.status]}</StatusBadge>
          {r.reviewNote && <div className="cell-sub" style={{ marginTop: 4 }}>{r.reviewerName}: {r.reviewNote}</div>}
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="My Time" sub={`Sessions from the last ${windowDays} days. Forgot to stop a timer? Ask for it to be corrected.`} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div><h3>Recent sessions</h3></div></div>
        <DataTable columns={sessionColumns} rows={sessions} emptyTitle="No sessions yet" emptySub={`Time you log in the last ${windowDays} days appears here.`} />
      </div>

      <div className="card">
        <div className="card-head"><div><h3>My requests</h3></div></div>
        <DataTable columns={requestColumns} rows={requests} emptyTitle="No requests" emptySub="Corrections you ask for appear here with the decision." />
      </div>

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title="Request a time correction"
        footer={<>
          <button className="btn" onClick={() => setTarget(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Sending…' : 'Send request'}</button>
        </>}
      >
        {target && (
          <>
            <div style={{ fontWeight: 700 }}>{target.taskName}</div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
              {target.projectName} · {String(target.logDate).slice(0, 10)} · recorded {fmtHours(target.durationMinutes)}
            </div>
            <FormField label="Time it should be">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="number" min="0" max="24" className="filter-input" style={{ width: 80 }} aria-label="Hours" value={hours} onChange={(e) => setHours(e.target.value)} /> h
                <input type="number" min="0" max="59" className="filter-input" style={{ width: 80 }} aria-label="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} /> min
              </div>
            </FormField>
            <FormField label="Why should it change?">
              <textarea
                className="filter-input"
                style={{ width: '100%', minHeight: 80, fontFamily: 'inherit' }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. I forgot to stop the timer when I left at 5pm"
                maxLength={500}
              />
            </FormField>
            {formError && <div role="alert" style={{ color: 'var(--status-red)', fontSize: 12.5 }}>{formError}</div>}
          </>
        )}
      </Modal>
    </>
  );
}
