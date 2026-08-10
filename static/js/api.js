// fetch() wrapper: JSON, auth-gate on 401, offline banner, error toasts.
import { toast } from './ui.js';

// The free host sleeps after ~15 min idle; the next request then waits on a
// cold start. Track in-flight requests so a slow one shows "waking up" instead
// of an unexplained frozen screen, and cap how long we ever hang.
const WAKE_HINT_MS = 2500;
const TIMEOUT_MS = 90000;
let pending = 0;
let wakeTimer = null;

function wakeBanner(show) {
  const b = document.getElementById('wake-banner');
  if (b) b.hidden = !show;
}

function pendingStart() {
  if (++pending === 1) wakeTimer = setTimeout(() => wakeBanner(true), WAKE_HINT_MS);
}

function pendingEnd() {
  if (--pending <= 0) {
    pending = 0;
    clearTimeout(wakeTimer);
    wakeBanner(false);
  }
}

async function request(method, path, body) {
  let res;
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  pendingStart();
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    document.getElementById('offline-banner').hidden = true;
  } catch (e) {
    document.getElementById('offline-banner').hidden = false;
    if (e.name === 'AbortError') toast('Server took too long — pull to retry');
    throw e;
  } finally {
    clearTimeout(killer);
    pendingEnd();
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
