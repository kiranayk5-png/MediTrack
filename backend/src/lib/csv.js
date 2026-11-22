function csvCell(value) {
  let text = value == null ? '' : String(value);
  // Prefix spreadsheet formula starters so exported text cannot execute as a formula.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function sendCsv(res, filename, columns, rows) {
  const lines = [columns.map((column) => csvCell(column.label)).join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column.key])).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${lines.join('\r\n')}`);
}

module.exports = { sendCsv };
