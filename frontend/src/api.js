import { resolveApiUrl } from './apiBase';

const API_URL = resolveApiUrl(import.meta.env.VITE_API_URL, window.location);

export async function api(path, options = {}) {
  const { raw, headers: requestHeaders, ...requestOptions } = options;
  const response = await fetch(`${API_URL}${path}`, {
    ...requestOptions,
    credentials: 'include',
    headers: { ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}), ...requestHeaders },
  });
  if (raw && response.ok) return response;
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'The request could not be completed.');
    error.status = response.status;
    error.code = data?.error?.code;
    error.details = data?.error?.details;
    throw error;
  }
  return data;
}

export const json = (method, body) => ({ method, body: JSON.stringify(body) });
