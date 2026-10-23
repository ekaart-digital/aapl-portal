import React, { useEffect, useState } from 'react';
import PageHeader from '../../components/layout/PageHeader';
import DataTable from '../../components/common/DataTable';
import StatusBadge from '../../components/common/StatusBadge';
import Modal from '../../components/common/Modal';
import FormField from '../../components/common/FormField';
import Tabs from '../../components/common/Tabs';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import { useApp } from '../../context/AppContext';
import * as correctionsApi from '../../api/corrections';
import { fmtHours } from '../../utils/formatters';

const STATUS_BADGE = { pending: 'amber', approved: 'green', rejected: 'red' };
const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };

// Time corrections that the people I am responsible for have asked for.
export default function Approvals() {
  const { pushToast } = useApp();
  const [tab, setTab] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [decision, setDecision] = useState(null); // { request, kind: 'approve' | 'reject' }
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setRequests(await correctionsApi.listForReview(tab));
    } catch (err) {
      setError(err.message || 'Failed to load requests.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  function open(request, kind) {
    setDecision({ request, kind });
    setNote('');
    setFormError('');
  }

  async function submit() {
    const { request, kind } = decision;
    if (kind === 'reject' && note.trim().length < 3) {
      setFormError('Explain why, so the employee understands the decision.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (kind === 'approve') await correctionsApi.approveRequest(request.id, note.trim());
      else await correctionsApi.rejectRequest(request.id, note.trim());
      pushToast(kind === 'approve' ? 'Correction approved. The hours were updated.' : 'Request declined.');
      setDecision(null);
      await load();
    } catch (err) {
      setFormError(err.message || 'Could not save your decision.');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'employee', header: 'Employee', render: (r) => r.employeeName },
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
    { key: 'reason', header: 'Reason', render: (r) => r.reason },
    {
      key: 'status',
      header: tab === 'pending' ? '' : 'Decision',
      render: (r) => (r.status === 'pending' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-primary" onClick={() => open(r, 'approve')}>Approve</button>
          <button className="btn btn-sm" onClick={() => open(r, 'reject')}>Decline</button>
        </div>
      ) : (
        <>
          <StatusBadge severity={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
          <div className="cell-sub" style={{ marginTop: 4 }}>{r.reviewerName}{r.reviewNote ? `: ${r.reviewNote}` : ''}</div>
        </>
      )),
    },
  ];

  return (
    <>
      <PageHeader title="Approvals" sub="Time corrections your people have asked for" />
      <div className="card">
        <div className="card-pad">
          <Tabs
            items={[{ label: 'Waiting for me', value: 'pending' }, { label: 'All requests', value: 'all' }]}
            active={tab}
            onChange={setTab}
          />
          {loading ? <Loading label="Loading requests…" /> : error ? (
            <EmptyState icon="AlertTriangle" title="Couldn't load requests" sub={error} action={<button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button>} />
          ) : (
            <DataTable columns={columns} rows={requests} emptyTitle={tab === 'pending' ? 'Nothing waiting' : 'No requests yet'} emptySub="Corrections your team asks for will appear here." />
          )}
        </div>
      </div>

      <Modal
        open={!!decision}
        onClose={() => setDecision(null)}
        title={decision?.kind === 'approve' ? 'Approve this correction' : 'Decline this correction'}
        footer={<>
          <button className="btn" onClick={() => setDecision(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : decision?.kind === 'approve' ? 'Approve' : 'Decline'}
          </button>
        </>}
      >
        {decision && (
          <>
            <div style={{ fontWeight: 700 }}>{decision.request.employeeName} · {decision.request.taskName}</div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
              {fmtHours(decision.request.originalMinutes)} → {fmtHours(decision.request.requestedMinutes)}
            </div>
            <div style={{ fontSize: 13, marginBottom: 14 }}>“{decision.request.reason}”</div>
            <FormField label={decision.kind === 'approve' ? 'Note (optional)' : 'Why are you declining?'}>
              <textarea
                className="filter-input"
                style={{ width: '100%', minHeight: 70, fontFamily: 'inherit' }}
                value={note}
                onChange={(e) => setNote(e.target.value)}
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
