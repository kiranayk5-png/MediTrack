export function isMedicineActive(value) {
  return value === true || value === 1 || value === '1';
}

export function sortMedicineRows(rows, sort) {
  const values = Array.isArray(rows) ? rows : [];
  const { key = 'name', direction = 'asc' } = sort || {};
  return [...values].sort((left, right) => {
    const a = key === 'status' ? Number(isMedicineActive(left.isActive)) : String(left[key] || '').toLocaleLowerCase();
    const b = key === 'status' ? Number(isMedicineActive(right.isActive)) : String(right[key] || '').toLocaleLowerCase();
    const comparison = typeof a === 'number' ? a - b : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    return direction === 'desc' ? -comparison : comparison;
  });
}
