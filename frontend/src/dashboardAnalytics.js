const numeric = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

function toDateKey(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  return '';
}

export function buildSalesSeries(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    date: toDateKey(row?.date),
    revenue: numeric(row?.revenue),
    transactions: numeric(row?.transactions),
  })).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.revenue !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildInventoryHealthSignals(metrics) {
  if (!metrics || typeof metrics !== 'object') return [];
  return [
    { key: 'lowStockBatches', label: 'Low stock', value: numeric(metrics.lowStockBatches), color: '#e7ad58', route: '/inventory' },
    { key: 'expiringBatches', label: 'Expiring soon', value: numeric(metrics.expiringBatches), color: '#a995f2', route: '/alerts' },
    { key: 'expiredBatches', label: 'Expired', value: numeric(metrics.expiredBatches), color: '#e87987', route: '/alerts' },
  ].filter((item) => item.value !== null);
}

export function buildStockByMedicine(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({ name: String(row?.name || '').trim(), quantity: numeric(row?.quantity) }))
    .filter((row) => row.name && row.quantity !== null);
}

export function buildStockStatusDistribution(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    status: String(row?.status || '').trim(),
    count: numeric(row?.count),
  })).filter((row) => row.status && row.count !== null);
}

export function salesEmptyMessage(series) {
  return series.length ? null : 'No completed sales are available for this period.';
}
