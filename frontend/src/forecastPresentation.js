export function getForecastChartRows(rows, limit = 10) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, limit).map((row) => ({
    ...row,
    predictedDemand: Number(row.predictedDemand),
  }));
}

export function summarizeForecastCoverage(rows) {
  const records = Array.isArray(rows) ? rows : [];
  const insufficient = records.filter((row) => row.dataQuality === 'insufficient').length;
  const limited = records.filter((row) => row.dataQuality === 'limited').length;
  return { total: records.length, insufficient, limited, lessReliable: insufficient + limited };
}

export function formatForecastCoverageSummary(summary) {
  if (!summary?.lessReliable) return '';
  const parts = [];
  if (summary.insufficient) parts.push(`${summary.insufficient} insufficient`);
  if (summary.limited) parts.push(`${summary.limited} limited`);
  return `${summary.lessReliable} of ${summary.total} forecasts have ${parts.join(' and ')} historical sales coverage. Fewer observed selling days make estimates less reliable. This is a data-coverage signal, not an accuracy score.`;
}
