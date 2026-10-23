// columns: [{ header, value: (row) => string | number }]; numeric values stay numeric in Excel.

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

export async function exportToExcel({ fileName, columns, rows }) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');

  const header = columns.map((c) => ({ value: c.header, fontWeight: 'bold' }));
  const body = rows.map((row) => columns.map((c) => {
    const v = c.value(row);
    if (typeof v === 'number') return { value: v, type: Number };
    return { value: v == null ? '' : String(v), type: String };
  }));

  await writeExcelFile([header, ...body], {
    columns: columns.map((c) => ({ width: Math.max(14, c.header.length + 4) })),
  }).toFile(`${fileName}-${stamp()}.xlsx`);
}

export async function exportToPdf({ fileName, title, subtitle, columns, rows }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(15);
  doc.text(title, 40, 42);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`${subtitle ? `${subtitle}  |  ` : ''}Generated ${stamp()}`, 40, 58);

  autoTable(doc, {
    startY: 72,
    head: [columns.map((c) => c.header)],
    body: rows.map((row) => columns.map((c) => {
      const v = c.value(row);
      return v == null ? '' : String(v);
    })),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [27, 79, 114] },
    margin: { left: 40, right: 40 },
  });

  doc.save(`${fileName}-${stamp()}.pdf`);
}

// CSV (SRS section 45). Values with commas, quotes or line breaks are quoted;
// the file starts with a byte-order mark so Excel reads accented names correctly.
export function toCsv(columns, rows) {
  const cell = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  rows.forEach((row) => lines.push(columns.map((c) => cell(c.value(row))).join(',')));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export async function exportToCsv({ fileName, columns, rows }) {
  const blob = new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}-${stamp()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
