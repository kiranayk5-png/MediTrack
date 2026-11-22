const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

export function resolveApiUrl(configuredUrl, pageLocation) {
  const fallback = `${pageLocation.protocol}//${pageLocation.hostname}:4000/api`;
  const apiUrl = new URL(configuredUrl || fallback);

  // Cookies are host-scoped. Keep local frontend and API requests on one
  // loopback hostname so the HttpOnly session cookie is consistently sent.
  if (LOOPBACK_HOSTS.has(pageLocation.hostname) && LOOPBACK_HOSTS.has(apiUrl.hostname)) {
    apiUrl.hostname = pageLocation.hostname;
  }

  return apiUrl.href.replace(/\/+$/, '');
}
