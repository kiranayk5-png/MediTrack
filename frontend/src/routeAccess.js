const managementRoles = new Set(['platform_admin', 'pharmacy_manager']);

export function canAccessManagementRoutes(role) {
  return managementRoles.has(role);
}
