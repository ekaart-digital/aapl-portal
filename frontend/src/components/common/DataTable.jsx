import React from 'react';
import EmptyState from './EmptyState';

export default function DataTable({ columns, rows, onRowClick, emptyTitle = 'No records found', emptySub = 'Try adjusting your filters.' }) {
  if (!rows || rows.length === 0) {
    return <EmptyState title={emptyTitle} sub={emptySub} icon="Search" />;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key} style={c.width ? { width: c.width } : undefined}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || row.employeeId || i} className={onRowClick ? 'clickable' : ''} onClick={() => onRowClick && onRowClick(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.className || ''}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
