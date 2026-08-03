// Calendar: Day | Week toggle, due-tasks interleaved into day view.
import { api } from '../api.js';
import {
  el, openSheet, closeSheet, confirmDialog, emptyState,
  setHeader, todayISO, addDays, mondayOf, fmtDate, weekdayName,
} from '../ui.js';
import { taskRow } from './tasks.js';

let mode = localStorage.getItem('calMode') || 'day';
let anchor = todayISO(); // day shown (day mode) / any day in week (week mode)
let viewRoot = null;

export function quickAdd() {
  openEventSheet({ date: anchor }, refresh);
}

function refresh() {
  if (viewRoot) render(viewRoot);
}

export async function render(viewEl) {
  viewRoot = viewEl;
  viewEl.innerHTML = '';
  setHeader('Calendar');

  const seg = el('div', { class: 'segmented' },
    [['day', 'Day'], ['week', 'Week']].map(([m, label]) =>
      el('button', {
        class: m === mode ? 'active' : '',
        onclick: () => { mode = m; localStorage.setItem('calMode', m); refresh(); },
      }, label)));
  viewEl.append(seg);

  if (mode === 'day') await renderDay(viewEl);
  else await renderWeek(viewEl);
}

function navBar(title, onPrev, onNext) {
  return el('div', { class: 'cal-nav' },
    el('button', { onclick: onPrev }, '‹'),
    el('button', { class: 'cal-title', style: 'color:var(--text)', onclick: () => { anchor = todayISO(); refresh(); } }, title),
    el('button', { onclick: onNext }, '›'),
  );
}

async function renderDay(viewEl) {
  const t = todayISO();
  const isToday = anchor === t;
  viewEl.append(navBar(
    isToday ? 'Today' : fmtDate(anchor, { weekday: true }),
    () => { anchor = addDays(anchor, -1); refresh(); },
    () => { anchor = addDays(anchor, 1); refresh(); },
  ));

  const [events, dueTasks] = await Promise.all([
    api.get(`/api/events?start=${anchor}&end=${anchor}`),
    api.get(`/api/tasks?kind=task&status=open&top_level=true&date=${anchor}`),
  ]);
  const tasksThatDay = dueTasks.filter((x) => x.due_date === anchor);

  if (!events.length && !tasksThatDay.length) {
    viewEl.append(emptyState('🌤️', 'Nothing on this day.', 'Add event', quickAdd));
    return;
  }

  if (events.length) {
    viewEl.append(el('div', { class: 'card' }, events.map((e) => eventRow(e))));
  }
  if (tasksThatDay.length) {
    viewEl.append(el('div', { class: 'section' },
      el('div', { class: 'section-label' }, 'Due this day'),
      el('div', { class: 'card' }, tasksThatDay.map((task) => taskRow(task, refresh)))));
  }
}

async function renderWeek(viewEl) {
  const monday = mondayOf(anchor);
  const sunday = addDays(monday, 6);
  const t = todayISO();
  viewEl.append(navBar(
    `Week of ${fmtDate(monday)}`,
    () => { anchor = addDays(monday, -7); refresh(); },
    () => { anchor = addDays(monday, 7); refresh(); },
  ));

  const [events, allTasks] = await Promise.all([
    api.get(`/api/events?start=${monday}&end=${sunday}`),
    api.get(`/api/tasks?kind=task&status=open&top_level=true`),
  ]);

  const card = el('div', { class: 'card' });
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const dayEvents = events.filter((e) => e.date === d);
    const dayTasks = allTasks.filter((x) => x.due_date === d);
    const bits = [
      ...dayEvents.map((e) => (e.all_day ? e.title : `${e.start_time || ''} ${e.title}`.trim())),
      ...dayTasks.map((x) => `☐ ${x.title}`),
    ];
    card.append(el('div', {
      class: 'row tappable week-day-row' + (d === t ? ' today-row' : ''),
      onclick: () => { anchor = d; mode = 'day'; localStorage.setItem('calMode', 'day'); refresh(); },
    },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, `${weekdayName(d)} ${fmtDate(d)}`),
        bits.length ? el('div', { class: 'row-sub' }, bits.join(' · ')) : null,
      ),
      el('span', { style: 'color:var(--text-dim)' }, '›'),
    ));
  }
  viewEl.append(card);
}

function eventRow(e) {
  return el('div', { class: 'row tappable', onclick: () => openEventSheet(e, refresh) },
    el('div', { class: 'event-time' }, e.all_day ? 'all day' : (e.start_time || '—')),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, e.title),
      el('div', { class: 'row-sub' },
        [e.end_time && !e.all_day ? `until ${e.end_time}` : null, e.location].filter(Boolean).join(' · ') || null),
    ),
  );
}

export function openEventSheet(ev, onSaved) {
  const isNew = !ev.id;
  const titleInput = el('input', { type: 'text', value: ev.title || '', placeholder: "What's happening?", autofocus: isNew });
  const dateInput = el('input', { type: 'date', value: ev.date || todayISO() });
  const startInput = el('input', { type: 'time', value: ev.start_time || '' });
  const endInput = el('input', { type: 'time', value: ev.end_time || '' });
  const locationInput = el('input', { type: 'text', value: ev.location || '', placeholder: 'Location' });
  const notesInput = el('textarea', { placeholder: 'Notes' }, ev.notes || '');
  const allDayInput = el('input', { type: 'checkbox', checked: ev.all_day || false, style: 'width:auto' });

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const title = titleInput.value.trim();
      if (!title) return;
      const payload = {
        title,
        date: dateInput.value,
        start_time: allDayInput.checked ? null : (startInput.value || null),
        end_time: allDayInput.checked ? null : (endInput.value || null),
        all_day: allDayInput.checked,
        location: locationInput.value.trim() || null,
        notes: notesInput.value.trim() || null,
      };
      if (isNew) await api.post('/api/events', payload);
      else await api.patch(`/api/events/${ev.id}`, payload);
      closeSheet();
      onSaved();
    },
  },
    el('div', { class: 'field' }, titleInput),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', {}, 'Date'), dateInput),
      el('div', { class: 'field' }, el('label', {}, 'Start'), startInput),
      el('div', { class: 'field' }, el('label', {}, 'End'), endInput)),
    el('div', { class: 'field' }, el('label', { style: 'display:flex;align-items:center;gap:8px' }, allDayInput, 'All day')),
    el('div', { class: 'field' }, el('label', {}, 'Location'), locationInput),
    el('div', { class: 'field' }, el('label', {}, 'Notes'), notesInput),
    el('button', { class: 'btn-primary', type: 'submit' }, isNew ? 'Add' : 'Save'),
    !isNew ? el('button', {
      type: 'button', class: 'btn-ghost', style: 'color:var(--danger)',
      onclick: async () => {
        if (!(await confirmDialog(`Delete "${ev.title}"?`))) return;
        await api.del(`/api/events/${ev.id}`);
        closeSheet();
        onSaved();
      },
    }, 'Delete') : null,
  );

  openSheet(isNew ? 'New event' : 'Edit event', form);
}
