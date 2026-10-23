import React from 'react';
import { useApp } from '../../context/AppContext';

export default function ToastStack() {
  const { toasts } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>{t.message}</div>
      ))}
    </div>
  );
}
