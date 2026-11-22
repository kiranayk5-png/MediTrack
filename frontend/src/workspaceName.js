export function getWorkspaceName(user, pharmacies = []) {
  if (!user?.pharmacyId) return 'Platform workspace';
  return pharmacies.find((pharmacy) => Number(pharmacy.id) === Number(user.pharmacyId))?.name || 'Assigned pharmacy';
}
