import React, { useEffect, useState } from 'react';
import Modal from '../common/Modal';
import FormField from '../common/FormField';
import { useApp } from '../../context/AppContext';
import * as timelogsApi from '../../api/timelogs';
import { fmtHours } from '../../utils/formatters';

// Lets a manager set the credited time of a finished session. A note is
// required so the change can be explained later; 0h 0m voids the session.
export default function AdjustSessionModal({ session, onClose, onSaved }) {
  const { pushToast } = useApp();
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('0');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    const total = session.durationMinutes || 0;
    setHours(String(Math.floor(total / 60)));
    setMinutes(String(total % 60));
    setNote('');
  }, [session]);

  if (!session) return null;

  async function handleSave() {
    const h = Number(hours);
    const m = Number(minutes);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59) {
      pushToast('Enter whole hours and minutes (minutes 0–59).');
      return;
    }
    const total = h * 60 + m;
    if (total > 24 * 60) {
      pushToast('A single session cannot be credited more than 24 hours.');
      return;
    }
    if (note.trim().length < 3) {
      pushToast('Add a short note explaining the change.');
      return;
    }
    setSaving(true);
    try {
      const updated = await timelogsApi.adjustSession(session.id, total, note.trim());
      onSaved(updated);
      pushToast('Session updated.');
    } catch (err) {
      pushToast(err.message || 'Failed to update session.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Adjust session"
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </>}
    >
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
        {session.employeeName ? `${session.employeeName} · ` : ''}{session.taskName ? `${session.taskName} · ` : ''}
        {session.logDate} · currently {fmtHours(session.durationMinutes || 0)}
        {session.autoStopped ? ' (stopped automatically after being left running)' : ''}
      </div>
      <div className="grid-2">
        <FormField label="Hours">
          <input type="number" min="0" max="24" className="filter-input" style={{ width: '100%' }} value={hours} onChange={(e) => setHours(e.target.value)} />
        </FormField>
        <FormField label="Minutes">
          <input type="number" min="0" max="59" className="filter-input" style={{ width: '100%' }} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </FormField>
      </div>
      <FormField label="Reason for the change (required)">
        <textarea
          className="filter-input"
          style={{ width: '100%', minHeight: 70, fontFamily: 'inherit' }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Confirmed with employee: stopped work at 5:30pm"
        />
      </FormField>
      <div className="muted" style={{ fontSize: 11.5 }}>Set 0h 0m to remove the time while keeping a record of the session.</div>
    </Modal>
  );
}
