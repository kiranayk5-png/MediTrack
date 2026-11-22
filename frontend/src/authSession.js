export async function logoutSession(request, clearUser) {
  await request('/auth/logout', { method: 'POST' });
  clearUser(null);
}
