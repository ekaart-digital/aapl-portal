import React, { useEffect, useState } from 'react';
import PageHeader from '../../components/layout/PageHeader';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import { useApp } from '../../context/AppContext';
import * as auditApi from '../../api/audit';
import { roleLabel } from '../../auth/roles';
import { exportToExcel, exportToCsv } from '../../utils/exportReport';

const PAGE_SIZE = 50;

const TYPE_LABELS = {
  auth: 'Sign-ins and passwords',
  employee: 'People',
  department: 'Departments',
  'sub-department': 'Sub-disciplines',
  team: 'Teams',
  project: 'Projects',
  task: 'Tasks',
  'time-log': 'Logged hours',
  correction: 'Time corrections',
  settings: 'Settings',
};

const EXPORT_COLUMNS = [
  { header: 'When', value: (r) => new Date(r.at).toLocaleString() },
  { header: 'Who', value: (r) => r.actorName },
  { header: 'Role', value: (r) => (r.actorRole ? roleLabel(r.actorRole) : 'System') },
  { header: 'Action', value: (r) => r.action },
  { header: 'What', value: (r) => r.summary },
];

// Turns the stored details into short readable lines: "status: Planning → In Progress".
export function describeDetails(details) {
  if (!details || typeof details !== 'object') return [];
  const isChange = (v) => v && typeof v === 'object' && 'from' in v && 'to' in v;
  if (isChange(details)) return [`${String(details.from ?? '—')} → ${String(details.to ?? '—')}`];
  return Object.entries(details).map(([key, value]) => {
    if (isChange(value)) return `${key}: ${String(value.from ?? '—')} → ${String(value.to ?? '—')}`;
    return `${key}: ${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '—')}`;
  });
}

// The audit trail (SRS §35): who changed what, and when.
export default function Audit() {
  const { pushToast } = useApp();
  const [filters, setFilters] = useState({ entityType: '', q: '', from: '', to: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(0);
  const [data, setData] = useState({ entries: [], total: 0, entityTypes: [] });
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await auditApi.listAudit({ ...applied, limit: PAGE_SIZE, offset: page * PAGE_SIZE }));
    } catch (err) {
      setError(err.message || 'Failed to load the audit trail.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [applied, page]); // eslint-disable-line react-hooks/exhaustive-deps

  function apply(e) {
    e.preventDefault();
    setPage(0);
    setApplied(filters);
  }

  const first = data.total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min(data.total, (page + 1) * PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="Audit Trail"
        sub="Who changed what, and when"
        actions={<>
          <button className="btn" onClick={() => exportToCsv({ fileName: 'audit-trail', columns: EXPORT_COLUMNS, rows: data.entries }).catch((err) => pushToast(err.message || 'Export failed.'))} disabled={!data.entries.length}>Export CSV</button>
          <button className="btn" onClick={() => exportToExcel({ fileName: 'audit-trail', columns: EXPORT_COLUMNS, rows: data.entries }).catch((err) => pushToast(err.message || 'Export failed.'))} disabled={!data.entries.length}>Export this page</button>
        </>}
      />

      <form className="filter-bar" onSubmit={apply}>
        <select className="filter-select" aria-label="Area" value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}>
          <option value="">All areas</option>
          {data.entityTypes.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
        </select>
        <input className="filter-input" aria-label="Search" placeholder="Search what happened…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          From <input type="date" className="filter-input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </label>
        <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          To <input type="date" className="filter-input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </label>
        <button className="btn btn-primary" type="submit">Apply</button>
      </form>

      <div className="card">
        {loading ? <Loading label="Loading the audit trail…" /> : error ? (
          <EmptyState icon="AlertTriangle" title="Couldn't load the audit trail" sub={error} action={<button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button>} />
        ) : data.entries.length === 0 ? (
          <EmptyState title="Nothing recorded" sub="No changes match these filters." icon="Search" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th style={{ width: 150 }}>When</th><th style={{ width: 200 }}>Who</th><th>What happened</th><th style={{ width: 80 }} /></tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => {
                    const lines = describeDetails(e.details);
                    const isOpen = open === e.id;
                    return (
                      <React.Fragment key={e.id}>
                        <tr>
                          <td className="mono" style={{ fontSize: 12 }}>{new Date(e.at).toLocaleString()}</td>
                          <td>
                            <div className="cell-primary">{e.actorName}</div>
                            <div className="cell-sub">{e.actorRole ? roleLabel(e.actorRole) : 'System'}</div>
                          </td>
                          <td>
                            <div>{e.summary}</div>
                            <div className="cell-sub mono">{e.action}</div>
                          </td>
                          <td>
                            {lines.length > 0 && (
                              <button className="link-btn" style={{ background: 'none', border: 'none' }} onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}>
                                {isOpen ? 'Hide' : 'Details'}
                              </button>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td />
                            <td colSpan={3}>
                              {lines.map((line) => <div key={line} className="mono" style={{ fontSize: 12 }}>{line}</div>)}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 12.5 }}>Showing {first}–{last} of {data.total}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" onClick={() => setPage(page - 1)} disabled={page === 0}>Newer</button>
                <button className="btn btn-sm" onClick={() => setPage(page + 1)} disabled={last >= data.total}>Older</button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
