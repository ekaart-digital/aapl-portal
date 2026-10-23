import React from 'react';

export default function PageHeader({ title, sub, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {sub ? <div className="page-sub">{sub}</div> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </div>
  );
}
