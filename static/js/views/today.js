// Today dashboard — the home screen.
import { api } from '../api.js';
import { el, setHeader, todayISO, fmtFullDate, daysBetween, emptyState, checkbox } from '../ui.js';
import { openTaskSheet, toggleComplete, taskRow, callRow, occurrenceRow } from './tasks.js';

let viewRoot = null;

export function quickAdd() {
  openTaskSheet({ kind: 'task', due_date: todayISO() }, refresh);
}

function refresh() {
  if (viewRoot) render(viewRoot);
}

export async function render(viewEl) {
  viewRoot = viewEl;
  viewEl.innerHTML = '';
  const t = todayISO();
  setHeader('Today', fmtFullDate(t));

  const data = await api.get(`/api/today?date=${t}`);

  // Overdue — attention first.
  if (data.overdue_tasks.length) {
    viewEl.append(section('Overdue', 'tasks',
      el('div', { class: 'card danger-tint' },
        data.overdue_tasks.map((task) => taskRow(task, refresh)))));
  }

  // Schedule.
  const schedCard = data.events.length
    ? el('div', { class: 'card' }, data.events.map(eventRow))
    : el('div', { class: 'card' }, el('div', { class: 'row' },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-sub' }, 'Nothing scheduled today'))));
  viewEl.append(section('Schedule', 'calendar', schedCard));

  // Daily missions with progress.
  if (data.dailies.length) {
    const done = data.dailies.filter((d) => d.done_today).length;
    const card = el('div', { class: 'card' },
      el('div', { class: 'dailies-progress' },
        el('div', { class: 'progress-label' }, `${done} of ${data.dailies.length} done`),
        el('div', { class: 'progress' },
          el('div', { style: `width:${data.dailies.length ? (done / data.dailies.length) * 100 : 0}%` }))),
      data.dailies.map((d) => dailyRow(d)),
    );
    viewEl.append(section('Daily missions', 'tasks', card));
  }

  // Due today (plain + recurring occurrences).
  if (data.due_tasks.length) {
    const rows = data.due_tasks.flatMap((task) =>
      task.kind === 'recurring' && task.pending_dates && task.pending_dates.length
        ? task.pending_dates.map((d) => occurrenceRow(task, d, refresh))
        : [taskRow(task, refresh)]);
    viewEl.append(section('Due today', 'tasks', el('div', { class: 'card' }, rows)));
  }

  // Calls to make.
  if (data.calls_due.length) {
    viewEl.append(section('Calls', 'tasks',
      el('div', { class: 'card' }, data.calls_due.map((c) => callRow(c, refresh))),
      () => localStorage.setItem('tasksSegment', 'calls')));
  }

  // Meals strip.
  const m = data.meals;
  if (m.breakfast || m.lunch || m.dinner) {
    viewEl.append(section('Meals', 'meals',
      el('div', { class: 'card tappable', onclick: () => { location.hash = '#/meals'; } },
        el('div', { class: 'meals-strip' },
          m.breakfast ? el('span', {}, el('b', {}, 'B'), m.breakfast) : null,
          m.lunch ? el('span', {}, el('b', {}, 'L'), m.lunch) : null,
          m.dinner ? el('span', {}, el('b', {}, 'D'), m.dinner) : null,
        ))));
  }

  const nothingElse = !data.overdue_tasks.length && !data.due_tasks.length
    && !data.dailies.length && !data.calls_due.length && !data.events.length;
  if (nothingElse) {
    viewEl.append(emptyState('🧘', 'A completely clear day. Rare and beautiful.', 'Add something', quickAdd));
  }
}

function dailyRow(d) {
  return el('div', { class: 'row' + (d.done_today ? ' done' : '') },
    checkbox(d.done_today, () => toggleComplete(d, refresh)),
    el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, d.title)),
    d.streak_current > 0 ? el('span', { class: 'pill streak' }, `🔥 ${d.streak_current}`) : null,
  );
}

function eventRow(e) {
  return el('div', { class: 'row' },
    el('div', { class: 'event-time' }, e.all_day ? 'all day' : (e.start_time || '')),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, e.title),
      e.location ? el('div', { class: 'row-sub' }, e.location) : null,
    ),
  );
}

function section(label, route, card, beforeNav = null) {
  return el('div', { class: 'section' },
    el('div', { class: 'section-label' },
      label,
      el('a', { href: `#/${route}`, onclick: beforeNav || undefined }, 'See all')),
    card,
  );
}
