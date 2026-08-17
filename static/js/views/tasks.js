// Tasks view: segmented Tasks | Projects | Routines | Calls + project detail. Exports openTaskSheet.
import { api } from '../api.js';
import {
  el, openSheet, closeSheet, toast, confirmDialog, emptyState, checkbox,
  setHeader, todayISO, fmtDate, daysBetween, PRIORITY_NAMES,
} from '../ui.js';

let segment = localStorage.getItem('tasksSegment') || 'tasks';
let sectionsCache = [];
let currentParams = [];
let viewRoot = null;

// Each segment manages its own section list.
const SECTION_KIND = { tasks: 'task', projects: 'project', routines: 'routine', calls: 'call' };

// Sections change rarely but were refetched on every render and every sheet
// open — a whole round trip in front of the UI. Memoize per kind instead.
const sectionMemo = new Map();

function sectionsFor(kind) {
  if (!sectionMemo.has(kind)) {
    sectionMemo.set(kind, api.get(`/api/sections?kind=${kind}`).catch((e) => {
      sectionMemo.delete(kind);
      throw e;
    }));
  }
  return sectionMemo.get(kind);
}

function invalidateSections() {
  sectionMemo.clear();
}

// task.kind -> section kind
function sectionKindFor(taskKind) {
  return { task: 'task', project: 'project', daily: 'routine', recurring: 'routine', call: 'call' }[taskKind] || 'task';
}

function getSectionFilter() {
  return localStorage.getItem(`sectionFilter-${segment}`) || 'all';
}

function setSectionFilter(v) {
  localStorage.setItem(`sectionFilter-${segment}`, v);
}

export function quickAdd() {
  if (currentParams.length) {
    openTaskSheet({ kind: 'task', parent_id: Number(currentParams[0]) }, refresh);
  } else if (segment === 'projects') {
    openTaskSheet({ kind: 'project' }, refresh);
  } else if (segment === 'routines') {
    openTaskSheet({ kind: 'daily' }, refresh);
  } else if (segment === 'calls') {
    openTaskSheet({ kind: 'call' }, refresh);
  } else {
    openTaskSheet({ kind: 'task' }, refresh);
  }
}

function refresh() {
  if (viewRoot) render(viewRoot, currentParams);
}

// Renders await network data before appending. If a second render starts while
// the first is in flight (tapping a segment on a slow connection), both would
// append into the same node and the screen would show its contents twice.
// Every render takes a sequence number and bails after each await if a newer
// one has started.
let renderSeq = 0;
const stale = (seq) => seq !== renderSeq;

export async function render(viewEl, params = []) {
  const seq = ++renderSeq;
  viewRoot = viewEl;
  currentParams = params;
  viewEl.innerHTML = '';
  if (params.length) return renderProjectDetail(viewEl, Number(params[0]), seq);

  // Paint the chrome before awaiting data — the tab bar should never be
  // missing while a request is in flight.
  const sectionsBtn = el('button', { class: 'header-action', onclick: openSectionsSheet }, '🗂 Sections');
  setHeader('Tasks', null, sectionsBtn);
  const seg = el('div', { class: 'segmented' },
    ['tasks', 'projects', 'routines', 'calls'].map((s) =>
      el('button', {
        class: s === segment ? 'active' : '',
        onclick: () => { segment = s; localStorage.setItem('tasksSegment', s); render(viewEl, params); },
      }, s[0].toUpperCase() + s.slice(1))));
  viewEl.append(seg);

  sectionsCache = await sectionsFor(SECTION_KIND[segment]);
  if (stale(seq)) return;
  if (getSectionFilter() !== 'all' && !sectionsCache.some((s) => String(s.id) === getSectionFilter())) {
    setSectionFilter('all');
  }

  if (segment === 'tasks') await renderTasks(viewEl, seq);
  else if (segment === 'projects') await renderProjects(viewEl, seq);
  else if (segment === 'calls') await renderCalls(viewEl, seq);
  else await renderRoutines(viewEl, seq);
}

// Timed items first (by HH:MM), untimed after.
function byTime(a, b) {
  return (a.due_time == null) - (b.due_time == null)
    || (a.due_time || '').localeCompare(b.due_time || '');
}

function sectionFilterRow() {
  if (!sectionsCache.length) return null;
  const current = getSectionFilter();
  const opts = [['all', 'All'], ...sectionsCache.map((s) => [String(s.id), s.name])];
  return el('div', { class: 'chip-group', style: 'margin:4px 0 8px' }, opts.map(([v, label]) =>
    el('button', {
      class: v === current ? 'active' : '',
      onclick: () => { setSectionFilter(v); refresh(); },
    }, label)));
}

function matchesFilter(x) {
  const current = getSectionFilter();
  return current === 'all' || String(x.section_id ?? '') === current;
}

// Collapsed-by-default disclosure for done items: "Done (N) ▸" toggles the card.
function collapsedSection(label, rows) {
  const card = el('div', { class: 'card', style: 'display:none' }, rows);
  const arrow = el('span', {}, '▸');
  const header = el('div', {
    class: 'section-label tappable', style: 'cursor:pointer',
    onclick: () => {
      const open = card.style.display === 'none';
      card.style.display = open ? '' : 'none';
      arrow.textContent = open ? '▾' : '▸';
    },
  }, `${label} (${rows.length})`, arrow);
  return el('div', { class: 'section' }, header, card);
}

// Group items by section: defined sections in order, then unsectioned last.
function groupBySection(items, fallbackLabel = 'Other') {
  const groups = [];
  for (const s of sectionsCache) {
    const rows = items.filter((x) => x.section_id === s.id);
    if (rows.length) groups.push([s.name, rows]);
  }
  const rest = items.filter((x) => !sectionsCache.some((s) => s.id === x.section_id));
  if (rest.length) groups.push([sectionsCache.length ? fallbackLabel : null, rest]);
  return groups;
}

// ---- Plain tasks ----
async function renderTasks(viewEl, seq) {
  const t = todayISO();
  const fetched = await api.get(`/api/tasks?kind=task&top_level=true&date=${t}`);
  if (stale(seq)) return;
  const all = fetched.filter(matchesFilter);
  const open = all.filter((x) => x.status === 'open');
  const doneToday = all.filter((x) => x.status === 'done');

  const sections = {
    Overdue: open.filter((x) => x.due_date && x.due_date < t).sort(byTime),
    Today: open.filter((x) => x.due_date === t).sort(byTime),
    Upcoming: open.filter((x) => x.due_date && x.due_date > t)
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || byTime(a, b)),
    Someday: open.filter((x) => !x.due_date),
  };

  const filterRow = sectionFilterRow();
  if (filterRow) viewEl.append(filterRow);

  let any = false;
  for (const [label, items] of Object.entries(sections)) {
    if (!items.length) continue;
    any = true;
    viewEl.append(section(label, items.map((task) => taskRow(task))));
  }
  if (doneToday.length) {
    viewEl.append(collapsedSection('Done', doneToday.map((task) => taskRow(task))));
  }
  if (!any && !doneToday.length) {
    viewEl.append(emptyState('🌤️', 'Nothing on your plate. Enjoy it — or add something.', 'Add a task', quickAdd));
  }
}

// ---- Projects ----
function projectRow(p) {
  const pct = p.subtask_total ? Math.round((p.subtask_done / p.subtask_total) * 100) : 0;
  const dueBit = p.due_date ? ` · due ${fmtDate(p.due_date)}${p.due_time ? ` ${p.due_time}` : ''}` : '';
  return el('div', {
    class: 'row tappable', onclick: () => { location.hash = `#/tasks/${p.id}`; },
  },
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, p.title),
      el('div', { class: 'row-sub' }, `${p.subtask_done}/${p.subtask_total} done${dueBit}`),
      el('div', { class: 'progress', style: 'margin-top:6px' }, el('div', { style: `width:${pct}%` })),
    ),
    el('span', { style: 'color:var(--text-dim)' }, '›'),
  );
}

async function renderProjects(viewEl, seq) {
  const projects = await api.get('/api/tasks?kind=project');
  if (stale(seq)) return;
  const open = projects.filter((p) => p.status === 'open');
  const done = projects.filter((p) => p.status === 'done');
  if (!open.length && !done.length) {
    viewEl.append(emptyState('🏗️', 'No projects yet. Big things start here.', 'New project', quickAdd));
    return;
  }
  const groups = groupBySection(open);
  for (const [label, items] of groups) {
    const card = el('div', { class: 'card' }, items.map(projectRow));
    viewEl.append(label ? section(label, [card]) : card);
  }
  if (done.length) viewEl.append(collapsedSection('Done', done.map(projectRow)));
}

async function renderProjectDetail(viewEl, id, seq) {
  const t = todayISO();
  const all = await api.get('/api/tasks?kind=project');
  if (stale(seq)) return;
  const project = all.find((p) => p.id === id);
  if (!project) { location.hash = '#/tasks'; return; }

  const back = el('button', { class: 'header-action', onclick: () => { location.hash = '#/tasks'; } }, '‹ Projects');
  const edit = el('button', {
    class: 'header-action',
    onclick: () => openTaskSheet(project, () => render(viewRoot, currentParams)),
  }, 'Edit');
  setHeader(project.title, `${project.subtask_done}/${project.subtask_total} done`,
    el('div', { class: 'header-actions' }, back, edit));

  const subs = await api.get(`/api/tasks?parent_id=${id}&date=${t}`);
  if (stale(seq)) return;
  const openSubs = subs.filter((s) => s.status === 'open');
  const doneSubs = subs.filter((s) => s.status === 'done');

  // Quick inline subtask add.
  const input = el('input', { type: 'text', placeholder: '＋ Add a step…' });
  viewEl.append(el('form', {
    class: 'field', style: 'margin-top:8px',
    onsubmit: async (e) => {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      await api.post(`/api/tasks?date=${t}`, { title, kind: 'task', parent_id: id });
      render(viewRoot, currentParams);
    },
  }, input));

  if (openSubs.length) viewEl.append(section('To do', openSubs.map((s) => taskRow(s))));
  if (doneSubs.length) viewEl.append(collapsedSection('Done', doneSubs.map((s) => taskRow(s))));
  if (!subs.length) viewEl.append(emptyState('📝', 'Break this project into small steps.'));

  viewEl.append(el('button', {
    class: 'btn-ghost', style: 'color:var(--danger);margin-top:24px',
    onclick: async () => {
      if (!(await confirmDialog(`Delete project "${project.title}" and all its steps?`))) return;
      await api.del(`/api/tasks/${id}`);
      location.hash = '#/tasks';
    },
  }, 'Delete project'));
}

// ---- Routines (daily + recurring) ----
async function renderRoutines(viewEl, seq) {
  const t = todayISO();
  const items = await api.get(`/api/tasks?kind=daily,recurring&date=${t}`);
  if (stale(seq)) return;

  if (!items.length) {
    viewEl.append(emptyState('🔁', 'Routines keep life on rails. Add a daily mission or recurring task.', 'New routine', quickAdd));
    return;
  }

  // Done-today dailies collapse away; open ones + recurring occurrences stay visible.
  const doneToday = items.filter((x) => x.kind === 'daily' && x.done_today);
  const active = items.filter((x) => !(x.kind === 'daily' && x.done_today));

  const rowsFor = (list) => {
    const dailies = list.filter((x) => x.kind === 'daily');
    const recurring = list.filter((x) => x.kind === 'recurring');
    return [
      ...dailies.map((d) => routineRow(d)),
      ...recurring.flatMap((r) => recurringRows(r)),
    ];
  };

  if (!sectionsCache.length) {
    const dailies = active.filter((x) => x.kind === 'daily');
    const recurring = active.filter((x) => x.kind === 'recurring');
    if (dailies.length) viewEl.append(section('Daily missions', dailies.map((d) => routineRow(d))));
    if (recurring.length) viewEl.append(section('Recurring', recurring.flatMap((r) => recurringRows(r))));
  } else {
    for (const [label, list] of groupBySection(active)) {
      viewEl.append(section(label || 'Routines', rowsFor(list)));
    }
  }
  if (doneToday.length) {
    viewEl.append(collapsedSection('Done today', doneToday.map((d) => routineRow(d))));
  }
}

// A recurring task renders one row per pending occurrence, or a "Next: …" row.
function recurringRows(t) {
  if (t.pending_dates && t.pending_dates.length) {
    return t.pending_dates.map((d) => occurrenceRow(t, d, refresh));
  }
  return [el('div', { class: 'row tappable', onclick: () => openTaskSheet(t, refresh) },
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, t.title),
      el('div', { class: 'row-sub' }, `${ruleInWords(t)}${t.next_due ? ` · next ${fmtDate(t.next_due)}` : ''}`),
    ),
  )];
}

export function ruleInWords(t) {
  const time = t.due_time ? ` at ${t.due_time}` : '';
  if (t.kind === 'daily') return `Every day${time}`;
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const n = t.recur_interval || 1;
  if (t.recur_unit === 'week' && t.recur_weekdays) {
    const days = t.recur_weekdays.split(',').map((x) => WD[Number(x)]).join(', ');
    return (n === 1 ? `Every ${days}` : `Every ${n} weeks · ${days}`) + time;
  }
  if (t.recur_unit === 'month') return (n === 1 ? 'Every month' : `Every ${n} months`) + time;
  if (t.recur_unit === 'week') return (n === 1 ? 'Every week' : `Every ${n} weeks`) + time;
  return (n === 1 ? 'Every day' : `Every ${n} days`) + time;
}

// Decline an occurrence (daily or recurring): resolve it without completing.
// Optimistic like completing — the row leaves at once, the POST follows.
export function skipRoutine(t, dateISO, rowEl, onChange = refresh) {
  if (rowEl) rowEl.remove();
  api.post(`/api/tasks/${t.id}/skip?date=${dateISO}`)
    .then(() => toast('Declined', 'Undo', async () => {
      await api.post(`/api/tasks/${t.id}/unskip?date=${dateISO}`);
      onChange();
    }))
    .catch(() => onChange());
}

export function skipButton(onSkip) {
  return el('button', {
    class: 'text-btn', type: 'button',
    onclick: (e) => { e.stopPropagation(); onSkip(); },
  }, '✗ Skip');
}

export function routineRow(t, onChange = refresh) {
  const today = todayISO();
  const overdue = t.next_due && t.next_due < today;
  // Declining resolves the occurrence that is actually outstanding.
  const skipDate = overdue ? t.next_due : today;
  let row;
  row = el('div', {
    class: 'row tappable' + (t.done_today ? ' done' : ''),
    onclick: () => openTaskSheet(t, onChange),
  },
    checkbox(t.done_today, () => toggleComplete(t, onChange, row)),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, t.title),
      el('div', { class: 'row-sub' }, ruleInWords(t) + (overdue ? ` · missed since ${fmtDate(t.next_due)}` : '')),
    ),
    overdue ? el('span', { class: 'pill overdue' }, 'due') : null,
    t.done_today ? null : skipButton(() => skipRoutine(t, skipDate, row, onChange)),
  );
  return row;
}

// One pending occurrence of a recurring task: ✓ complete or ✗ skip that date.
// Both resolve optimistically — the row leaves at once, the POST follows.
export function occurrenceRow(t, dateISO, onChange = refresh) {
  const today = todayISO();
  const missed = dateISO < today;
  const label = dateISO === today ? 'Today' : fmtDate(dateISO, { weekday: true });

  const resolve = (action, undoAction, msg) => {
    row.remove();
    api.post(`/api/tasks/${t.id}/${action}?date=${dateISO}`)
      .then(() => toast(msg, 'Undo', async () => {
        await api.post(`/api/tasks/${t.id}/${undoAction}?date=${dateISO}`);
        onChange();
      }))
      .catch(() => onChange());
  };

  let row;
  row = el('div', { class: 'row tappable', onclick: () => openTaskSheet(t, onChange) },
    checkbox(false, () => resolve('complete', 'uncomplete', 'Done ✓')),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, t.title),
      el('div', { class: 'row-sub' }, `${label}${missed ? ' · missed' : ''} · ${ruleInWords(t)}`),
    ),
    missed ? el('span', { class: 'pill overdue' }, 'due') : null,
    skipButton(() => resolve('skip', 'unskip', 'Declined')),
  );
  return row;
}

// ---- Calls ----
function waLink(phone) {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}

export function callRow(t, onChange = refresh) {
  const today = todayISO();
  const done = t.status === 'done';
  const subBits = [];
  if (t.due_date) {
    const diff = daysBetween(today, t.due_date);
    if (diff < 0) subBits.push(`${-diff}d overdue`);
    else if (diff === 0) subBits.push('today');
    else subBits.push(fmtDate(t.due_date));
    if (t.due_time) subBits.push(t.due_time);
  }
  if (t.notes) subBits.push(t.notes);

  let row;
  row = el('div', {
    class: `row tappable pri-${t.priority}` + (done ? ' done' : ''),
    onclick: () => openTaskSheet(t, onChange),
  },
    checkbox(done, () => toggleComplete(t, onChange, row)),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, t.title),
      subBits.length ? el('div', { class: 'row-sub' }, subBits.join(' · ')) : null,
    ),
    t.phone ? el('a', {
      class: 'icon-btn', href: `tel:${t.phone}`,
      'aria-label': 'Call', onclick: (e) => e.stopPropagation(),
    }, '📞') : null,
    t.phone ? el('a', {
      class: 'icon-btn', href: waLink(t.phone), target: '_blank', rel: 'noopener',
      'aria-label': 'WhatsApp', onclick: (e) => e.stopPropagation(),
    }, '💬') : null,
  );
  return row;
}

async function renderCalls(viewEl, seq) {
  const t = todayISO();
  const fetched = await api.get(`/api/tasks?kind=call&date=${t}`);
  if (stale(seq)) return;
  const all = fetched.filter(matchesFilter);
  const open = all.filter((x) => x.status === 'open');
  const done = all.filter((x) => x.status === 'done');

  if (!all.length) {
    viewEl.append(emptyState('📞', 'Calls you need to make, all in one place.', 'Add a call', quickAdd));
    return;
  }

  const filterRow = sectionFilterRow();
  if (filterRow) viewEl.append(filterRow);

  const sections = {
    Overdue: open.filter((x) => x.due_date && x.due_date < t).sort(byTime),
    Today: open.filter((x) => x.due_date === t).sort(byTime),
    Upcoming: open.filter((x) => x.due_date && x.due_date > t)
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || byTime(a, b)),
    Someday: open.filter((x) => !x.due_date),
  };
  for (const [label, items] of Object.entries(sections)) {
    if (!items.length) continue;
    viewEl.append(section(label, items.map((c) => callRow(c))));
  }
  if (done.length) viewEl.append(collapsedSection('Done', done.map((c) => callRow(c))));
}

// ---- Shared row + complete logic (used by today.js too) ----
export function taskRow(t, onChange = refresh) {
  const today = todayISO();
  const done = isDone(t);
  const subBits = [];
  if (t.due_date) {
    const diff = daysBetween(today, t.due_date);
    if (diff < 0) subBits.push(`${-diff}d overdue`);
    else if (diff === 0) subBits.push('today');
    else subBits.push(fmtDate(t.due_date));
    if (t.due_time) subBits.push(t.due_time);
  }
  if (t.kind === 'recurring') subBits.push(ruleInWords(t));

  let row;
  row = el('div', {
    class: `row tappable pri-${t.priority}` + (done ? ' done' : ''),
    onclick: () => openTaskSheet(t, onChange),
  },
    checkbox(done, () => toggleComplete(t, onChange, row)),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, t.title),
      subBits.length ? el('div', { class: 'row-sub' }, subBits.join(' · ')) : null,
    ),
    t.section_name ? el('span', { class: 'pill' }, t.section_name) : null,
  );
  return row;
}

export function isDone(t) {
  return ['task', 'project', 'call'].includes(t.kind) ? t.status === 'done' : t.done_today;
}

function paintDone(rowEl, done) {
  if (!rowEl) return;
  rowEl.classList.toggle('done', done);
  rowEl.querySelector('.check')?.classList.toggle('checked', done);
}

function setLocalDone(t, done) {
  if (['task', 'project', 'call'].includes(t.kind)) t.status = done ? 'done' : 'open';
  else t.done_today = done;
}

// Optimistic: paint the row immediately, POST in the background. A full
// re-render here would blank the screen for a round trip on every tap; the
// item settles into its Done group on the next natural render instead.
export function toggleComplete(t, onChange, rowEl = null) {
  const d = todayISO();
  const was = isDone(t);
  const now = !was;
  setLocalDone(t, now);
  paintDone(rowEl, now);

  api.post(`/api/tasks/${t.id}/${now ? 'complete' : 'uncomplete'}?date=${d}`)
    .then(() => {
      if (now) {
        toast('Done ✓', 'Undo', () => toggleComplete(t, onChange, rowEl));
      }
    })
    .catch(() => {
      setLocalDone(t, was);
      paintDone(rowEl, was);
      if (onChange) onChange();
    });
}

// ---- Task form (create/edit) — shared bottom sheet ----
export async function openTaskSheet(task, onSaved) {
  const isNew = !task.id;
  const kind = task.kind || 'task';
  const hasDue = ['task', 'project', 'call'].includes(kind);
  const isRoutine = kind === 'daily' || kind === 'recurring';
  const allSections = await sectionsFor(sectionKindFor(kind)).catch(() => []);
  const state = {
    recur_interval: task.recur_interval || 1,
    weekdays: task.recur_weekdays ? task.recur_weekdays.split(',').map(Number) : [],
    priority: task.priority || 0,
    section_id: task.section_id || null,
    // UI choice: daily | weekly | monthly | custom
    recur_choice: task.recur_unit === 'week' ? 'weekly'
      : task.recur_unit === 'month' ? 'monthly'
        : (task.recur_interval || 1) > 1 ? 'custom' : 'daily',
    // Custom = "every N <unit>" with a free unit choice.
    custom_unit: task.recur_unit === 'month' ? 'month' : task.recur_unit === 'week' ? 'week' : 'day',
  };

  const titleInput = el('input', { type: 'text', value: task.title || '', placeholder: titlePlaceholder(kind), autofocus: isNew });
  const notesInput = el('textarea', { placeholder: kind === 'call' ? 'What is it about?' : 'Notes' }, task.notes || '');
  const dueInput = el('input', { type: 'date', value: task.due_date || '' });
  const timeInput = el('input', { type: 'time', value: task.due_time || '' });
  const dueRow = el('div', { class: 'field-row' },
    el('div', { class: 'field' }, el('label', {}, 'Due date'), dueInput),
    el('div', { class: 'field' }, el('label', {}, 'Time'), timeInput),
  );

  // Phone + contact picker (calls only, always visible).
  const phoneInput = el('input', { type: 'tel', value: task.phone || '', placeholder: 'Phone (intl format for WhatsApp)' });
  const canPick = 'contacts' in navigator && 'ContactsManager' in window;
  const pickBtn = canPick ? el('button', {
    type: 'button', class: 'btn-ghost',
    onclick: async () => {
      try {
        const [c] = await navigator.contacts.select(['name', 'tel']);
        if (!c) return;
        if (c.tel && c.tel[0]) phoneInput.value = c.tel[0];
        if (c.name && c.name[0] && !titleInput.value.trim()) titleInput.value = c.name[0];
      } catch { /* user cancelled or picker unavailable */ }
    },
  }, '📇 Pick from contacts') : null;
  const phoneField = kind === 'call'
    ? el('div', { class: 'field' }, el('label', {}, 'Phone'), phoneInput, pickBtn)
    : null;

  // Section chips (all kinds).
  const sectionGroup = allSections.length ? el('div', { class: 'chip-group' },
    [[null, 'None'], ...allSections.map((s) => [s.id, s.name])].map(([id, name]) =>
      el('button', {
        type: 'button', class: state.section_id === id ? 'active' : '',
        onclick: (e) => {
          state.section_id = id;
          sectionGroup.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          e.target.classList.add('active');
        },
      }, name))) : null;

  // Priority chips.
  const priGroup = el('div', { class: 'chip-group' }, PRIORITY_NAMES.map((name, i) =>
    el('button', {
      type: 'button', class: state.priority === i ? 'active' : '',
      onclick: (e) => {
        state.priority = i;
        priGroup.querySelectorAll('button').forEach((b, j) => b.classList.toggle('active', j === i));
      },
    }, name)));

  // Recurrence controls (recurring kind only): Daily | Weekly | Monthly | Custom.
  const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const weekdayPicker = el('div', { class: 'weekday-picker' }, WD.map((w, i) =>
    el('button', {
      type: 'button', class: state.weekdays.includes(i) ? 'active' : '',
      onclick: (e) => {
        const idx = state.weekdays.indexOf(i);
        if (idx >= 0) state.weekdays.splice(idx, 1); else state.weekdays.push(i);
        e.target.classList.toggle('active');
      },
    }, w)));
  const intervalInput = el('input', { type: 'number', min: 1, value: state.recur_interval });
  const unitSelect = el('select', {},
    [['day', 'days'], ['week', 'weeks'], ['month', 'months']].map(([v, label]) =>
      el('option', { value: v, selected: state.custom_unit === v }, label)));
  unitSelect.value = state.custom_unit;
  unitSelect.addEventListener('change', () => { state.custom_unit = unitSelect.value; });
  const intervalLabel = el('label', {}, 'Repeat every');
  const UNIT_WORD = { daily: 'days', weekly: 'weeks', monthly: 'months' };
  const applyRecurChoice = () => {
    const c = state.recur_choice;
    intervalWrap.style.display = c === 'daily' ? 'none' : '';
    unitSelect.style.display = c === 'custom' ? '' : 'none';
    intervalSuffix.style.display = c === 'custom' ? 'none' : '';
    intervalSuffix.textContent = UNIT_WORD[c] || 'days';
    weekdayWrap.style.display = c === 'weekly' ? '' : 'none';
  };
  const recurTypeGroup = el('div', { class: 'chip-group', style: 'margin-bottom:12px' },
    [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['custom', 'Custom']].map(([c, label]) =>
      el('button', {
        type: 'button', class: state.recur_choice === c ? 'active' : '',
        onclick: (e) => {
          state.recur_choice = c;
          recurTypeGroup.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          e.target.classList.add('active');
          applyRecurChoice();
        },
      }, label)));
  const intervalSuffix = el('span', { class: 'unit-suffix' }, 'days');
  const intervalWrap = el('div', { class: 'field' }, intervalLabel,
    el('div', { class: 'inline-row' }, intervalInput, unitSelect, intervalSuffix));
  const weekdayWrap = el('div', { class: 'field' }, el('label', {}, 'On days'), weekdayPicker);
  applyRecurChoice();

  // Routines: start/next date + optional time of day.
  const startInput = el('input', { type: 'date', value: task.next_due || '' });
  const routineTimeInput = el('input', { type: 'time', value: task.due_time || '' });
  const routineWhenRow = el('div', { class: 'field-row' },
    el('div', { class: 'field' }, el('label', {}, isNew ? 'Starts on' : 'Next occurrence'), startInput),
    el('div', { class: 'field' }, el('label', {}, 'Time of day'), routineTimeInput),
  );

  const historyBtn = !isNew && isRoutine
    ? el('button', {
        type: 'button', class: 'more-options-toggle',
        onclick: () => openHistorySheet(task, onSaved),
      }, '🕘 History')
    : null;

  // More options expander (quick-add stays one field).
  const moreWrap = el('div', { style: isNew ? 'display:none' : '' },
    hasDue ? dueRow : null,
    kind !== 'project' ? el('div', { class: 'field' }, el('label', {}, 'Priority'), priGroup) : null,
    sectionGroup ? el('div', { class: 'field' }, el('label', {}, 'Section'), sectionGroup) : null,
    kind === 'recurring' ? el('div', { class: 'field' }, el('label', {}, 'Repeats'), recurTypeGroup, intervalWrap, weekdayWrap) : null,
    isRoutine ? routineWhenRow : null,
    el('div', { class: 'field' }, el('label', {}, 'Notes'), notesInput),
    historyBtn,
  );
  const moreToggle = isNew
    ? el('button', { type: 'button', class: 'more-options-toggle', onclick: () => { moreWrap.style.display = ''; moreToggle.remove(); } }, 'More options')
    : null;

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const title = titleInput.value.trim();
      if (!title) return;
      const payload = {
        title,
        notes: notesInput.value.trim() || null,
        priority: state.priority,
        due_date: hasDue ? (dueInput.value || null) : null,
        due_time: hasDue && dueInput.value ? (timeInput.value || null) : null,
        section_id: state.section_id,
      };
      if (kind === 'call') payload.phone = phoneInput.value.trim() || null;
      if (kind === 'recurring') {
        payload.recur_unit = state.recur_choice === 'custom' ? state.custom_unit
          : { daily: 'day', weekly: 'week', monthly: 'month' }[state.recur_choice];
        payload.recur_interval = state.recur_choice === 'daily' ? 1 : Number(intervalInput.value) || 1;
        payload.recur_weekdays = state.recur_choice === 'weekly' && state.weekdays.length
          ? [...state.weekdays].sort((a, b) => a - b).join(',') : null;
      }
      if (isRoutine) {
        // Routines carry their own time of day; next_due doubles as the start date.
        payload.due_time = routineTimeInput.value || null;
        if (startInput.value) payload.next_due = startInput.value;
      }
      if (isNew) {
        await api.post(`/api/tasks?date=${todayISO()}`, { ...payload, kind, parent_id: task.parent_id || null });
      } else {
        await api.patch(`/api/tasks/${task.id}`, payload);
      }
      closeSheet();
      onSaved();
    },
  },
    el('div', { class: 'field' }, titleInput),
    phoneField,
    moreToggle,
    moreWrap,
    el('button', { class: 'btn-primary', type: 'submit' }, isNew ? 'Add' : 'Save'),
    !isNew ? el('button', {
      type: 'button', class: 'btn-ghost', style: 'color:var(--danger)',
      onclick: async () => {
        if (!(await confirmDialog(`Delete "${task.title}"?`))) return;
        await api.del(`/api/tasks/${task.id}`);
        closeSheet();
        onSaved();
      },
    }, 'Delete') : null,
  );

  openSheet(isNew ? sheetTitle(kind) : 'Edit', form);
}

// ---- Routine history (read-only journal; deliberately tucked away) ----
const HISTORY_LABEL = {
  complete: '✓ Done', skip: '✗ Declined', uncomplete: '↩ Un-done',
  unskip: '↩ Un-declined', delete: '🗑 Routine deleted',
};

async function openHistorySheet(task, onSaved) {
  const body = el('div', {}, el('div', { class: 'row-sub', style: 'padding:8px 4px' }, 'Loading…'));
  openSheet(`History · ${task.title}`, el('div', {},
    el('button', {
      type: 'button', class: 'more-options-toggle',
      onclick: () => openTaskSheet(task, onSaved),
    }, '‹ Back to edit'),
    body,
  ));

  let log;
  try {
    log = await api.get(`/api/routines/history?task_id=${task.id}&limit=100`);
  } catch { return; }
  body.innerHTML = '';
  body.append(
    log.length
      ? el('div', { class: 'card', style: 'box-shadow:none;max-height:50vh;overflow-y:auto' },
          log.map((e) => el('div', { class: 'row' },
            el('div', { class: 'row-main' },
              el('div', { class: 'row-title' }, HISTORY_LABEL[e.action] || e.action),
              el('div', { class: 'row-sub' },
                [e.occurrence_date ? fmtDate(e.occurrence_date) : null, e.reason]
                  .filter(Boolean).join(' · ')),
            ))))
      : el('div', { class: 'empty' }, 'Nothing logged yet.'),
    el('a', {
      class: 'text-btn', style: 'display:inline-block;margin-top:8px',
      href: '/api/routines/history.csv',
    }, '⤓ Export every routine (CSV)'),
  );
}

// ---- Sections management (per segment — each module has its own list) ----
function openSectionsSheet() {
  return openSectionsSheetFor(SECTION_KIND[segment] || 'task',
    segment[0].toUpperCase() + segment.slice(1), refresh);
}

// Shared with the grocery screen, which keeps its own Section(kind='grocery') list.
export async function openSectionsSheetFor(kind, label, onChange) {
  const reopen = () => openSectionsSheetFor(kind, label, onChange);
  const list = await api.get(`/api/sections?kind=${kind}`);

  const input = el('input', { type: 'text', placeholder: '＋ New section (e.g. Work)' });
  const addForm = el('form', {
    class: 'field',
    onsubmit: async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      await api.post('/api/sections', { name, kind, sort_order: list.length });
      invalidateSections();
      onChange();
      reopen();
    },
  }, input);

  const rows = list.map((s) => {
    const row = el('div', { class: 'row' });
    const showName = () => {
      row.innerHTML = '';
      row.append(
        el('div', { class: 'row-main tappable', onclick: showRename },
          el('div', { class: 'row-title' }, s.name)),
        el('button', {
          class: 'text-btn danger', type: 'button',
          onclick: async () => {
            if (!(await confirmDialog(`Delete section "${s.name}"? Items keep their data, just lose the label.`))) return;
            await api.del(`/api/sections/${s.id}`);
            invalidateSections();
            onChange();
            reopen();
          },
        }, 'Delete'),
      );
    };
    const showRename = () => {
      const renameInput = el('input', { type: 'text', value: s.name });
      row.innerHTML = '';
      row.append(el('form', {
        class: 'field', style: 'flex:1',
        onsubmit: async (e) => {
          e.preventDefault();
          const name = renameInput.value.trim();
          if (name && name !== s.name) {
            await api.patch(`/api/sections/${s.id}`, { name });
            invalidateSections();
            onChange();
          }
          reopen();
        },
      }, renameInput));
      renameInput.focus();
    };
    showName();
    return row;
  });

  const content = el('div', {},
    addForm,
    rows.length ? el('div', { class: 'card', style: 'box-shadow:none' }, rows)
      : el('div', { class: 'row-sub', style: 'padding:8px 4px' }, 'No sections yet. Add Work, Finance, Personal…'),
  );
  openSheet(`Sections · ${label}`, content);
}

function titlePlaceholder(kind) {
  return {
    task: 'What needs doing?',
    project: 'Project name',
    daily: 'Daily mission (e.g. Exercise)',
    recurring: 'Recurring task (e.g. Water plants)',
    call: 'Who to call?',
  }[kind] || 'Title';
}

function sheetTitle(kind) {
  return {
    task: 'New task', project: 'New project', daily: 'New daily mission',
    recurring: 'New recurring task', call: 'New call',
  }[kind];
}

function section(label, rows) {
  return el('div', { class: 'section' },
    el('div', { class: 'section-label' }, label),
    el('div', { class: 'card' + (label === 'Overdue' ? ' danger-tint' : '') }, rows),
  );
}
