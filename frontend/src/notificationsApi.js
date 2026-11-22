export function listNotifications({ page = 1, status = 'all', type = '', severity = '' }, request) {
  const params = new URLSearchParams({ page: String(page), limit: '20', status });
  if (type) params.set('type', type);
  if (severity) params.set('severity', severity);
  return request(`/notifications?${params.toString()}`);
}

export function markNotificationRead(id, request) {
  return request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export function markAllNotificationsRead(request) {
  return request('/notifications/read-all', { method: 'POST', body: JSON.stringify({}) });
}
