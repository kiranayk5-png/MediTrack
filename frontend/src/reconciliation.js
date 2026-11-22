export const reconciliationReasons = [
  ['missing_stock', 'Missing stock'],
  ['damaged_stock', 'Damaged stock'],
  ['expired_stock', 'Expired stock'],
  ['excess_stock', 'Excess stock'],
  ['counting_error', 'Counting error'],
  ['other', 'Other'],
];

export function calculateDiscrepancy(physicalQuantity, systemQuantity) {
  if (physicalQuantity == null || physicalQuantity === '') return null;
  return Number(physicalQuantity) - Number(systemQuantity);
}

export function canReviewReconciliation(user, session) {
  return ['platform_admin', 'pharmacy_manager'].includes(user?.role)
    && session?.status === 'submitted'
    && Number(user?.id) !== Number(session?.createdBy);
}
