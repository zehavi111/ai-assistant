// Shared UI helpers: DOM builder, bottom sheet, toast, confirm, date utils.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

// ---- Bottom sheet ----
let sheetEls = null;

export function openSheet(title, contentEl) {
  closeSheet(true);
  const scrim = el('div', { class: 'sheet-scrim', onclick: () => closeSheet() });
  const sheet = el('div', { class: 'sheet' },
    el('div', { class: 'drag-handle' }),
    title ? el('h2', {}, title) : null,
    contentEl,
  );
  const container = document.getElementById('sheet-container');
  container.append(scrim, sheet);
  sheetEls = { scrim, sheet };
  requestAnimationFrame(() => { scrim.classList.add('open'); sheet.classList.add('open'); });
  const input = sheet.querySelector('input[autofocus]');
  if (input) setTimeout(() => input.focus(), 300);
}

export function closeSheet(instant = false) {
  if (!sheetEls) return;
  const { scrim, sheet } = sheetEls;
  sheetEls = null;
  if (instant) { scrim.remove(); sheet.remove(); return; }
  scrim.classList.remove('open');
  sheet.classList.remove('open');
  setTimeout(() => { scrim.remove(); sheet.remove(); }, 260);
}

// ---- Toast ----
let toastTimer = null;

export function toast(msg, actionLabel, actionFn) {
  const container = document.getElementById('toast-container');
  container.innerHTML = '';
  clearTimeout(toastTimer);
  const t = el('div', { class: 'toast' },
    el('span', {}, msg),
    actionLabel ? el('button', { onclick: () => { actionFn(); t.remove(); } }, actionLabel) : null,
  );
  container.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 3500);
}

export function confirmDialog(msg) {
  return Promise.resolve(window.confirm(msg));
}

// ---- Dates (all local — phone's clock is the truth) ----
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// Monday of the week containing iso.
export function mondayOf(iso) {
  const d = parseISO(iso);
  const shift = (d.getDay() + 6) % 7; // JS Sunday=0 → Monday=0 indexing
  d.setDate(d.getDate() - shift);
  return toISO(d);
}

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayName(iso) { return WD[(parseISO(iso).getDay() + 6) % 7]; }

export function fmtDate(iso, { weekday = false } = {}) {
  const d = parseISO(iso);
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return weekday ? `${WD[(d.getDay() + 6) % 7]}, ${base}` : base;
}

export function fmtFullDate(iso) {
  const d = parseISO(iso);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}

export function daysBetween(fromISO, toISOStr) {
  return Math.round((parseISO(toISOStr) - parseISO(fromISO)) / 86400000);
}

// ---- Shared components ----
export function emptyState(glyph, text, btnLabel, btnFn) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty-glyph' }, glyph),
    el('div', {}, text),
    btnLabel ? el('button', { onclick: btnFn }, btnLabel) : null,
  );
}

export function checkbox(checked, onToggle) {
  const c = el('button', { class: 'check' + (checked ? ' checked' : ''), 'aria-label': 'complete' },
    el('span', { class: 'check-circle' }, '✓'));
  c.addEventListener('click', (e) => { e.stopPropagation(); onToggle(); });
  return c;
}

export function setHeader(title, sub, actions) {
  const h = document.getElementById('header');
  h.innerHTML = '';
  const left = el('div', {},
    el('h1', {}, title),
    sub ? el('div', { class: 'header-sub' }, sub) : null,
  );
  h.append(left);
  if (actions) h.append(actions);
}

export const PRIORITY_NAMES = ['None', 'Low', 'Medium', 'High'];
