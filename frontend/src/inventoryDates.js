export function inventoryDateKey(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

export function isInventoryDateExpired(value, today = new Date()) {
  const current = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return inventoryDateKey(value) < current;
}

export function formatInventoryDate(value, locale = 'en-IN') {
  const key = inventoryDateKey(value);
  return key ? new Date(`${key}T00:00:00`).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }) : 'Date unavailable';
}
