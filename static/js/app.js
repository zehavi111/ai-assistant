// App shell: hash router, auth-gate, nav, theme, "More" sheet.
import { api } from './api.js';
import { el, openSheet, closeSheet } from './ui.js';
import * as login from './views/login.js';
import * as today from './views/today.js';
import * as tasks from './views/tasks.js';
import * as calendar from './views/calendar.js';
import * as people from './views/people.js';
import * as meals from './views/meals.js';
import * as study from './views/study.js';

const views = { login, today, tasks, calendar, people, meals, study };
const NAV_TABS = ['today', 'tasks', 'calendar', 'people'];
const MORE_ROUTES = ['meals', 'study'];

let currentView = null;

// ---- Theme ----
function applyTheme() {
  const saved = localStorage.getItem('theme');
  const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
}

export function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  localStorage.setItem('theme', dark ? 'light' : 'dark');
  applyTheme();
}

// ---- Router ----
function parseRoute() {
  const hash = location.hash.replace(/^#\//, '') || 'today';
  const [name, ...params] = hash.split('/');
  return { name, params };
}

async function navigate() {
  const { name, params } = parseRoute();
  const viewName = views[name] ? name : 'today';
  const view = views[viewName];

  const isLogin = viewName === 'login';
  document.getElementById('nav').hidden = isLogin;
  document.getElementById('fab').hidden = isLogin || !view.quickAdd;

  // Nav highlight: meals/study fall under "More".
  document.querySelectorAll('#nav button').forEach((b) => {
    const r = b.dataset.route;
    b.classList.toggle('active',
      r === viewName || (r === 'more' && MORE_ROUTES.includes(viewName)));
  });

  if (currentView?.destroy) currentView.destroy();
  currentView = view;
  if (!isLogin) localStorage.setItem('lastRoute', viewName);

  const viewEl = document.getElementById('view');
  viewEl.innerHTML = '';
  viewEl.scrollTop = 0;
  await view.render(viewEl, params);
}

window.addEventListener('hashchange', navigate);

// ---- FAB → view's quick-add ----
document.getElementById('fab').addEventListener('click', () => {
  if (currentView?.quickAdd) currentView.quickAdd();
});

// ---- Bottom nav ----
document.getElementById('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const route = btn.dataset.route;
  if (route === 'more') return openMoreSheet();
  location.hash = `#/${route}`;
});

function openMoreSheet() {
  const item = (ico, label, fn) =>
    el('div', { class: 'row tappable', onclick: fn },
      el('span', { style: 'font-size:22px' }, ico),
      el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, label)));
  const dark = document.documentElement.dataset.theme === 'dark';
  openSheet(null, el('div', { class: 'card', style: 'box-shadow:none' },
    item('🍽️', 'Meals', () => { closeSheet(); location.hash = '#/meals'; }),
    item('📚', 'Study', () => { closeSheet(); location.hash = '#/study'; }),
    item(dark ? '☀️' : '🌙', dark ? 'Light mode' : 'Dark mode', () => { toggleTheme(); closeSheet(); }),
    item('🚪', 'Log out', async () => {
      await api.post('/api/auth/logout');
      closeSheet();
      location.hash = '#/login';
    }),
  ));
}

// ---- Boot ----
async function boot() {
  applyTheme();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  try {
    await api.get('/api/auth/me');
    if (!location.hash || location.hash === '#/login') {
      location.hash = `#/${localStorage.getItem('lastRoute') || 'today'}`;
    }
  } catch {
    location.hash = '#/login';
  }
  navigate();
}

boot();
