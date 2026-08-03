// fetch() wrapper: JSON, auth-gate on 401, offline banner, error toasts.
import { toast } from './ui.js';

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    document.getElementById('offline-banner').hidden = true;
  } catch (e) {
    document.getElementById('offline-banner').hidden = false;
    throw e;
  }
  if (res.status === 401 && !path.includes('/auth/')) {
    location.hash = '#/login';
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let detail = 'Something went wrong';
    try { detail = (await res.json()).detail || detail; } catch {}
    if (!path.includes('/auth/')) toast(detail);
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
};
