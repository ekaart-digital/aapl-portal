import React from 'react';

export default function Loading({ label = 'Loading…' }) {
  return (
    <div className="page-loading">
      <span className="spinner" />
      {label}
    </div>
  );
}
