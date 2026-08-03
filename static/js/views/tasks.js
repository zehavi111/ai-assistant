// Tasks view: segmented Tasks | Projects | Routines + project detail. Exports openTaskSheet.
import { api } from '../api.js';
import {
  el, openSheet, closeSheet, toast, confirmDialog, emptyState, checkbox,
  setHeader, todayISO, fmtDate, daysBetween, PRIORITY_NAMES,
} from '../ui.js';

let segment = localStorage.getItem('tasksSegment') || 'tasks';
let currentParams = [];
let viewRoot = null;

export function quickAdd() {
  if (currentParams.length) {
    openTaskSheet({ kind: 'task', parent_id: Number(currentParams[0]) }, refresh);
  } else if (segment === 'projects') {
    openTaskSheet({ kind: 'project' }, refresh);
  } else if (segment === 'routines') {
    openTaskSheet({ kind: 'daily' }, refresh);
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

  setHeader('Tasks');
  const seg = el('div', { class: 'segmented' },
    ['tasks', 'projects', 'routines'].map((s) =>
      el('button', {
        class: s === segment ? 'active' : '',
        onclick: () => { segment = s; localStorage.setItem('tasksSegment', s); render(viewEl, params); },
      }, s[0].toUpperCase() + s.slice(1))));
  viewEl.append(seg);

  if (segment === 'tasks') await renderTasks(viewEl);
  else if (segment === 'projects') await renderProjects(viewEl);
  else await renderRoutines(viewEl);
}

// ---- Plain tasks ----
async function renderTasks(viewEl) {
  const t = todayISO();
  const all = await api.get(`/api/tasks?kind=task&top_level=true&date=${t}`);
  const open = all.filter((x) => x.status === 'open');
  const doneToday = all.filter((x) => x.status === 'done');

  const sections = {
    Overdue: open.filter((x) => x.due_date && x.due_date < t),
    Today: open.filter((x) => x.due_date === t),
    Upcoming: open.filter((x) => x.due_date && x.due_date > t),
    Someday: open.filter((x) => !x.due_date),
    Done: doneToday,
  };

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
async function renderProjects(viewEl) {
  const projects = await api.get('/api/tasks?kind=project');
  const open = projects.filter((p) => p.status === 'open');
  if (!open.length) {
    viewEl.append(emptyState('🏗️', 'No projects yet. Big things start here.', 'New project', quickAdd));
    return;
  }
  viewEl.append(el('div', { class: 'card' }, open.map((p) => {
    const pct = p.subtask_total ? Math.round((p.subtask_done / p.subtask_total) * 100) : 0;
    return el('div', {
      class: 'row tappable', onclick: () => { location.hash = `#/tasks/${p.id}`; },
    },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, p.title),
        el('div', { class: 'row-sub' }, `${p.subtask_done}/${p.subtask_total} done`),
        el('div', { class: 'progress', style: 'margin-top:6px' }, el('div', { style: `width:${pct}%` })),
      ),
      el('span', { style: 'color:var(--text-dim)' }, '›'),
    );
  })));
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
      await api.post('/api/tasks', { title, kind: 'task', parent_id: id });
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
  const dailies = items.filter((x) => x.kind === 'daily');
  const recurring = items.filter((x) => x.kind === 'recurring');

  if (!items.length) {
    viewEl.append(emptyState('🔁', 'Routines keep life on rails. Add a daily mission or recurring task.', 'New routine', quickAdd));
    return;
  }
  if (dailies.length) viewEl.append(section('Daily missions', dailies.map((d) => routineRow(d))));
  if (recurring.length) viewEl.append(section('Recurring', recurring.map((r) => routineRow(r))));
}

export function ruleInWords(t) {
  if (t.kind === 'daily') return 'Every day';
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  if (t.recur_unit === 'week' && t.recur_weekdays) {
    const days = t.recur_weekdays.split(',').map((n) => WD[Number(n)]).join(', ');
    return `Every ${days}`;
  }
  const n = t.recur_interval || 1;
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

// ---- Shared row + complete logic (used by today.js too) ----
export function taskRow(t, onChange = refresh) {
  const today = todayISO();
  const done = t.kind === 'task' || t.kind === 'project' ? t.status === 'done' : t.done_today;
  const subBits = [];
  if (t.due_date) {
    const diff = daysBetween(today, t.due_date);
    if (diff < 0) subBits.push(`${-diff}d overdue`);
    else if (diff === 0) subBits.push('today');
    else subBits.push(fmtDate(t.due_date));
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
    t.kind === 'daily' && t.streak_current > 0
      ? el('span', { class: 'pill streak' }, `🔥 ${t.streak_current}`) : null,
  );
}

export async function toggleComplete(t, onChange) {
  const d = todayISO();
  const done = t.kind === 'task' || t.kind === 'project' ? t.status === 'done' : t.done_today;
  const action = done ? 'uncomplete' : 'complete';
  await api.post(`/api/tasks/${t.id}/${action}?date=${d}`);
  if (!done) toast('Done ✓', 'Undo', async () => {
    await api.post(`/api/tasks/${t.id}/uncomplete?date=${d}`);
    onChange();
  });
  onChange();
}

// ---- Task form (create/edit) — shared bottom sheet ----
export function openTaskSheet(task, onSaved) {
  const isNew = !task.id;
  const kind = task.kind || 'task';
  const state = {
    recur_unit: task.recur_unit || (kind === 'recurring' ? 'day' : null),
    recur_interval: task.recur_interval || 1,
    weekdays: task.recur_weekdays ? task.recur_weekdays.split(',').map(Number) : [],
    priority: task.priority || 0,
  };

  const titleInput = el('input', { type: 'text', value: task.title || '', placeholder: titlePlaceholder(kind), autofocus: isNew });
  const notesInput = el('textarea', { placeholder: 'Notes' }, task.notes || '');
  const dueInput = el('input', { type: 'date', value: task.due_date || '' });

  // Priority chips.
  const priGroup = el('div', { class: 'chip-group' }, PRIORITY_NAMES.map((name, i) =>
    el('button', {
      type: 'button', class: state.priority === i ? 'active' : '',
      onclick: (e) => {
        state.priority = i;
        priGroup.querySelectorAll('button').forEach((b, j) => b.classList.toggle('active', j === i));
      },
    }, name)));

  // Recurrence controls (recurring kind only).
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
  const recurTypeGroup = el('div', { class: 'chip-group', style: 'margin-bottom:12px' },
    [['day', 'Every N days'], ['week', 'Weekdays']].map(([u, label]) =>
      el('button', {
        type: 'button', class: state.recur_unit === u ? 'active' : '',
        onclick: (e) => {
          state.recur_unit = u;
          recurTypeGroup.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          e.target.classList.add('active');
          intervalWrap.style.display = u === 'day' ? '' : 'none';
          weekdayWrap.style.display = u === 'week' ? '' : 'none';
        },
      }, label)));
  const intervalWrap = el('div', { class: 'field', style: state.recur_unit === 'week' ? 'display:none' : '' },
    el('label', {}, 'Repeat every N days'), intervalInput);
  const weekdayWrap = el('div', { class: 'field', style: state.recur_unit === 'week' ? '' : 'display:none' },
    el('label', {}, 'On days'), weekdayPicker);

  // More options expander (quick-add stays one field).
  const moreWrap = el('div', { style: isNew ? 'display:none' : '' },
    kind === 'task' ? el('div', { class: 'field' }, el('label', {}, 'Due date'), dueInput) : null,
    kind !== 'project' ? el('div', { class: 'field' }, el('label', {}, 'Priority'), priGroup) : null,
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
        due_date: kind === 'task' ? (dueInput.value || null) : null,
      };
      if (kind === 'recurring') {
        payload.recur_unit = state.recur_unit;
        payload.recur_interval = Number(intervalInput.value) || 1;
        payload.recur_weekdays = state.recur_unit === 'week' && state.weekdays.length
          ? [...state.weekdays].sort().join(',') : null;
      }
      if (isNew) {
        await api.post('/api/tasks', { ...payload, kind, parent_id: task.parent_id || null });
      } else {
        await api.patch(`/api/tasks/${task.id}`, payload);
      }
      closeSheet();
      onSaved();
    },
  },
    el('div', { class: 'field' }, titleInput),
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

function titlePlaceholder(kind) {
  return {
    task: 'What needs doing?',
    project: 'Project name',
    daily: 'Daily mission (e.g. Exercise)',
    recurring: 'Recurring task (e.g. Water plants)',
  }[kind] || 'Title';
}

function sheetTitle(kind) {
  return { task: 'New task', project: 'New project', daily: 'New daily mission', recurring: 'New recurring task' }[kind];
}

function section(label, rows) {
  return el('div', { class: 'section' },
    el('div', { class: 'section-label' }, label),
    el('div', { class: 'card' + (label === 'Overdue' ? ' danger-tint' : '') }, rows),
  );
}
