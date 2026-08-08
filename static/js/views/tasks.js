// Tasks view: segmented Tasks | Projects | Routines | Calls + project detail. Exports openTaskSheet.
import { api } from '../api.js';
import {
  el, openSheet, closeSheet, toast, confirmDialog, emptyState, checkbox,
  setHeader, todayISO, fmtDate, daysBetween, PRIORITY_NAMES,
} from '../ui.js';

let segment = localStorage.getItem('tasksSegment') || 'tasks';
let sectionFilter = localStorage.getItem('tasksSectionFilter') || 'all';
let sectionsCache = [];
let currentParams = [];
let viewRoot = null;

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

export async function render(viewEl, params = []) {
  viewRoot = viewEl;
  currentParams = params;
  viewEl.innerHTML = '';
  if (params.length) return renderProjectDetail(viewEl, Number(params[0]));

  sectionsCache = await api.get('/api/sections');
  if (sectionFilter !== 'all' && !sectionsCache.some((s) => String(s.id) === sectionFilter)) {
    sectionFilter = 'all';
  }

  const sectionsBtn = el('button', { class: 'header-action', onclick: openSectionsSheet }, '🗂 Sections');
  setHeader('Tasks', null, sectionsBtn);
  const seg = el('div', { class: 'segmented' },
    ['tasks', 'projects', 'routines', 'calls'].map((s) =>
      el('button', {
        class: s === segment ? 'active' : '',
        onclick: () => { segment = s; localStorage.setItem('tasksSegment', s); render(viewEl, params); },
      }, s[0].toUpperCase() + s.slice(1))));
  viewEl.append(seg);

  if (segment === 'tasks') await renderTasks(viewEl);
  else if (segment === 'projects') await renderProjects(viewEl);
  else if (segment === 'calls') await renderCalls(viewEl);
  else await renderRoutines(viewEl);
}

// Timed items first (by HH:MM), untimed after.
function byTime(a, b) {
  return (a.due_time == null) - (b.due_time == null)
    || (a.due_time || '').localeCompare(b.due_time || '');
}

function sectionFilterRow() {
  if (!sectionsCache.length) return null;
  const opts = [['all', 'All'], ...sectionsCache.map((s) => [String(s.id), s.name])];
  return el('div', { class: 'chip-group', style: 'margin:4px 0 8px' }, opts.map(([v, label]) =>
    el('button', {
      class: v === sectionFilter ? 'active' : '',
      onclick: () => { sectionFilter = v; localStorage.setItem('tasksSectionFilter', v); refresh(); },
    }, label)));
}

function matchesFilter(x) {
  return sectionFilter === 'all' || String(x.section_id ?? '') === sectionFilter;
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
async function renderTasks(viewEl) {
  const t = todayISO();
  const all = (await api.get(`/api/tasks?kind=task&top_level=true&date=${t}`)).filter(matchesFilter);
  const open = all.filter((x) => x.status === 'open');
  const doneToday = all.filter((x) => x.status === 'done');

  const sections = {
    Overdue: open.filter((x) => x.due_date && x.due_date < t).sort(byTime),
    Today: open.filter((x) => x.due_date === t).sort(byTime),
    Upcoming: open.filter((x) => x.due_date && x.due_date > t)
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || byTime(a, b)),
    Someday: open.filter((x) => !x.due_date),
    Done: doneToday,
  };

  const filterRow = sectionFilterRow();
  if (filterRow) viewEl.append(filterRow);

  let any = false;
  for (const [label, items] of Object.entries(sections)) {
    if (!items.length) continue;
    any = true;
    viewEl.append(section(label, items.map((task) => taskRow(task))));
  }
  if (!any) {
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

async function renderProjects(viewEl) {
  const projects = await api.get('/api/tasks?kind=project');
  const open = projects.filter((p) => p.status === 'open');
  if (!open.length) {
    viewEl.append(emptyState('🏗️', 'No projects yet. Big things start here.', 'New project', quickAdd));
    return;
  }
  const groups = groupBySection(open);
  for (const [label, items] of groups) {
    const card = el('div', { class: 'card' }, items.map(projectRow));
    viewEl.append(label ? section(label, [card]) : card);
  }
}

async function renderProjectDetail(viewEl, id) {
  const t = todayISO();
  const all = await api.get('/api/tasks?kind=project');
  const project = all.find((p) => p.id === id);
  if (!project) { location.hash = '#/tasks'; return; }

  const back = el('button', { class: 'header-action', onclick: () => { location.hash = '#/tasks'; } }, '‹ Projects');
  setHeader(project.title, `${project.subtask_done}/${project.subtask_total} done`, back);

  const subs = await api.get(`/api/tasks?parent_id=${id}&date=${t}`);
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
  if (doneSubs.length) viewEl.append(section('Done', doneSubs.map((s) => taskRow(s))));
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
async function renderRoutines(viewEl) {
  const t = todayISO();
  const items = await api.get(`/api/tasks?kind=daily,recurring&date=${t}`);

  if (!items.length) {
    viewEl.append(emptyState('🔁', 'Routines keep life on rails. Add a daily mission or recurring task.', 'New routine', quickAdd));
    return;
  }

  const rowsFor = (list) => {
    const dailies = list.filter((x) => x.kind === 'daily');
    const recurring = list.filter((x) => x.kind === 'recurring');
    return [
      ...dailies.map((d) => routineRow(d)),
      ...recurring.flatMap((r) => recurringRows(r)),
    ];
  };

  if (!sectionsCache.length) {
    const dailies = items.filter((x) => x.kind === 'daily');
    const recurring = items.filter((x) => x.kind === 'recurring');
    if (dailies.length) viewEl.append(section('Daily missions', dailies.map((d) => routineRow(d))));
    if (recurring.length) viewEl.append(section('Recurring', recurring.flatMap((r) => recurringRows(r))));
    return;
  }
  for (const [label, list] of groupBySection(items)) {
    viewEl.append(section(label || 'Routines', rowsFor(list)));
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
  if (t.kind === 'daily') return 'Every day';
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  if (t.recur_unit === 'week' && t.recur_weekdays) {
    const days = t.recur_weekdays.split(',').map((n) => WD[Number(n)]).join(', ');
    return `Every ${days}`;
  }
  const n = t.recur_interval || 1;
  if (t.recur_unit === 'month') return n === 1 ? 'Every month' : `Every ${n} months`;
  if (t.recur_unit === 'week') return n === 1 ? 'Every week' : `Every ${n} weeks`;
  return n === 1 ? 'Every day' : `Every ${n} days`;
}

function routineRow(t) {
  const today = todayISO();
  const overdue = t.next_due && t.next_due < today;
  return el('div', {
    class: 'row tappable' + (t.done_today ? ' done' : ''),
    onclick: () => openTaskSheet(t, refresh),
  },
    checkbox(t.done_today, () => toggleComplete(t, refresh)),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, t.title),
      el('div', { class: 'row-sub' }, ruleInWords(t) + (overdue ? ` · missed since ${fmtDate(t.next_due)}` : '')),
    ),
    t.kind === 'daily' && t.streak_current > 0
      ? el('span', { class: 'pill streak' }, `🔥 ${t.streak_current}`) : null,
    overdue ? el('span', { class: 'pill overdue' }, 'due') : null,
  );
}

// One pending occurrence of a recurring task: ✓ complete or ✗ skip that date.
export function occurrenceRow(t, dateISO, onChange = refresh) {
  const today = todayISO();
  const missed = dateISO < today;
  const label = dateISO === today ? 'Today' : fmtDate(dateISO, { weekday: true });
  return el('div', { class: 'row tappable', onclick: () => openTaskSheet(t, onChange) },
    checkbox(false, async () => {
      await api.post(`/api/tasks/${t.id}/complete?date=${dateISO}`);
      toast('Done ✓', 'Undo', async () => {
        await api.post(`/api/tasks/${t.id}/uncomplete?date=${dateISO}`);
        onChange();
      });
      onChange();
    }),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, t.title),
      el('div', { class: 'row-sub' }, `${label}${missed ? ' · missed' : ''} · ${ruleInWords(t)}`),
    ),
    missed ? el('span', { class: 'pill overdue' }, 'due') : null,
    el('button', {
      class: 'text-btn', type: 'button',
      onclick: async (e) => {
        e.stopPropagation();
        await api.post(`/api/tasks/${t.id}/skip?date=${dateISO}`);
        toast('Skipped', 'Undo', async () => {
          await api.post(`/api/tasks/${t.id}/unskip?date=${dateISO}`);
          onChange();
        });
        onChange();
      },
    }, '✗ Skip'),
  );
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

  return el('div', {
    class: `row tappable pri-${t.priority}` + (done ? ' done' : ''),
    onclick: () => openTaskSheet(t, onChange),
  },
    checkbox(done, () => toggleComplete(t, onChange)),
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
}

async function renderCalls(viewEl) {
  const t = todayISO();
  const all = (await api.get(`/api/tasks?kind=call&date=${t}`)).filter(matchesFilter);
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
    Done: done,
  };
  for (const [label, items] of Object.entries(sections)) {
    if (!items.length) continue;
    viewEl.append(section(label, items.map((c) => callRow(c))));
  }
}

// ---- Shared row + complete logic (used by today.js too) ----
export function taskRow(t, onChange = refresh) {
  const today = todayISO();
  const done = ['task', 'project', 'call'].includes(t.kind) ? t.status === 'done' : t.done_today;
  const subBits = [];
  if (t.due_date) {
    const diff = daysBetween(today, t.due_date);
    if (diff < 0) subBits.push(`${-diff}d overdue`);
    else if (diff === 0) subBits.push('today');
    else subBits.push(fmtDate(t.due_date));
    if (t.due_time) subBits.push(t.due_time);
  }
  if (t.kind === 'recurring') subBits.push(ruleInWords(t));

  return el('div', {
    class: `row tappable pri-${t.priority}` + (done ? ' done' : ''),
    onclick: () => openTaskSheet(t, onChange),
  },
    checkbox(done, () => toggleComplete(t, onChange)),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, t.title),
      subBits.length ? el('div', { class: 'row-sub' }, subBits.join(' · ')) : null,
    ),
    t.section_name ? el('span', { class: 'pill' }, t.section_name) : null,
    t.kind === 'daily' && t.streak_current > 0
      ? el('span', { class: 'pill streak' }, `🔥 ${t.streak_current}`) : null,
  );
}

export async function toggleComplete(t, onChange) {
  const d = todayISO();
  const done = ['task', 'project', 'call'].includes(t.kind) ? t.status === 'done' : t.done_today;
  const action = done ? 'uncomplete' : 'complete';
  await api.post(`/api/tasks/${t.id}/${action}?date=${d}`);
  if (!done) toast('Done ✓', 'Undo', async () => {
    await api.post(`/api/tasks/${t.id}/uncomplete?date=${d}`);
    onChange();
  });
  onChange();
}

// ---- Task form (create/edit) — shared bottom sheet ----
export async function openTaskSheet(task, onSaved) {
  const isNew = !task.id;
  const kind = task.kind || 'task';
  const hasDue = ['task', 'project', 'call'].includes(kind);
  const allSections = await api.get('/api/sections').catch(() => []);
  const state = {
    recur_interval: task.recur_interval || 1,
    weekdays: task.recur_weekdays ? task.recur_weekdays.split(',').map(Number) : [],
    priority: task.priority || 0,
    section_id: task.section_id || null,
    // UI choice: daily | weekly | monthly | custom
    recur_choice: task.recur_unit === 'week' ? 'weekly'
      : task.recur_unit === 'month' ? 'monthly'
        : (task.recur_interval || 1) > 1 ? 'custom' : 'daily',
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
  const intervalLabel = el('label', {}, state.recur_choice === 'monthly' ? 'Every N months' : 'Repeat every N days');
  const applyRecurChoice = () => {
    intervalWrap.style.display = state.recur_choice === 'custom' || state.recur_choice === 'monthly' ? '' : 'none';
    weekdayWrap.style.display = state.recur_choice === 'weekly' ? '' : 'none';
    intervalLabel.textContent = state.recur_choice === 'monthly' ? 'Every N months' : 'Repeat every N days';
  };
  const recurTypeGroup = el('div', { class: 'chip-group', style: 'margin-bottom:12px' },
    [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['custom', 'Every N days']].map(([c, label]) =>
      el('button', {
        type: 'button', class: state.recur_choice === c ? 'active' : '',
        onclick: (e) => {
          state.recur_choice = c;
          recurTypeGroup.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          e.target.classList.add('active');
          applyRecurChoice();
        },
      }, label)));
  const intervalWrap = el('div', { class: 'field' }, intervalLabel, intervalInput);
  const weekdayWrap = el('div', { class: 'field' }, el('label', {}, 'On days'), weekdayPicker);
  applyRecurChoice();

  // More options expander (quick-add stays one field).
  const moreWrap = el('div', { style: isNew ? 'display:none' : '' },
    hasDue ? dueRow : null,
    kind !== 'project' ? el('div', { class: 'field' }, el('label', {}, 'Priority'), priGroup) : null,
    sectionGroup ? el('div', { class: 'field' }, el('label', {}, 'Section'), sectionGroup) : null,
    kind === 'recurring' ? el('div', { class: 'field' }, el('label', {}, 'Repeats'), recurTypeGroup, intervalWrap, weekdayWrap) : null,
    el('div', { class: 'field' }, el('label', {}, 'Notes'), notesInput),
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
        payload.recur_unit = { daily: 'day', weekly: 'week', monthly: 'month', custom: 'day' }[state.recur_choice];
        payload.recur_interval = state.recur_choice === 'daily' ? 1 : Number(intervalInput.value) || 1;
        payload.recur_weekdays = state.recur_choice === 'weekly' && state.weekdays.length
          ? [...state.weekdays].sort().join(',') : null;
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

// ---- Sections management ----
async function openSectionsSheet() {
  const list = await api.get('/api/sections');

  const input = el('input', { type: 'text', placeholder: '＋ New section (e.g. Work)' });
  const addForm = el('form', {
    class: 'field',
    onsubmit: async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      await api.post('/api/sections', { name, sort_order: list.length });
      refresh();
      openSectionsSheet();
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
            if (!(await confirmDialog(`Delete section "${s.name}"? Tasks keep their data, just lose the label.`))) return;
            await api.del(`/api/sections/${s.id}`);
            refresh();
            openSectionsSheet();
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
          if (name && name !== s.name) { await api.patch(`/api/sections/${s.id}`, { name }); refresh(); }
          openSectionsSheet();
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
  openSheet('Sections', content);
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
