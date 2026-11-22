const REASON_CODES = ['missing_stock', 'damaged_stock', 'expired_stock', 'excess_stock', 'counting_error', 'other'];

function calculateDiscrepancy(physicalQuantity, systemQuantity) {
  return Number(physicalQuantity) - Number(systemQuantity);
}

function splitHistoryDeltas(discrepancy) {
  const deltas = [];
  let remaining = Number(discrepancy);
  while (remaining !== 0) {
    const delta = Math.max(-2147483648, Math.min(2147483647, remaining));
    deltas.push(delta);
    remaining -= delta;
  }
  return deltas;
}

module.exports = { REASON_CODES, calculateDiscrepancy, splitHistoryDeltas };
