function positiveSafeInteger(value, field) {
  const integer = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(integer) || integer <= 0) {
    throw new Error(`${field} must be a valid positive whole number.`);
  }
  return integer;
}

export function buildSalePayload({ role, pharmacyId, cart, discount }) {
  const items = cart.map((line) => ({
    medicineId: positiveSafeInteger(line.medicineId, 'Medicine ID'),
    quantity: positiveSafeInteger(line.quantity, 'Quantity'),
  }));
  const discountAmount = Number(discount || 0);
  if (!Number.isFinite(discountAmount) || discountAmount < 0) {
    throw new Error('Discount must be zero or a positive amount.');
  }

  return {
    ...(role === 'platform_admin' ? { pharmacyId: positiveSafeInteger(pharmacyId, 'Pharmacy ID') } : {}),
    items,
    discountAmount,
    taxRate: 0,
  };
}

export function checkoutValidationMessage(error) {
  if (error?.code !== 'VALIDATION_ERROR' || !Array.isArray(error.details)) {
    return error?.message || 'The sale could not be completed. Please try again.';
  }

  const messages = new Set();
  for (const issue of error.details) {
    const path = String(issue?.path || '');
    if (path === 'pharmacyId') messages.add('Select a valid sale pharmacy.');
    else if (path === 'items') messages.add('Add between 1 and 50 medicines to the basket.');
    else if (/^items\.\d+\.medicineId$/.test(path)) messages.add('A medicine selection is invalid. Remove it and add it again.');
    else if (/^items\.\d+\.quantity$/.test(path)) messages.add('Each medicine quantity must be a positive whole number.');
    else if (path === 'discountAmount') messages.add('Discount must be zero or a positive amount.');
    else if (path === 'taxRate') messages.add('The tax rate is invalid.');
    else messages.add('One or more checkout fields need attention.');
  }

  return messages.size ? `Please correct: ${[...messages].join(' ')}` : 'Please check the sale details and try again.';
}
