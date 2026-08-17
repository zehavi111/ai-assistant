// Weekly meal planner + meal library + grocery notes.
import { api } from '../api.js';
import {
  el, openSheet, closeSheet, toast, confirmDialog,
  setHeader, todayISO, addDays, mondayOf, fmtDate, weekdayName,
} from '../ui.js';

let weekStart = mondayOf(todayISO());
let viewRoot = null;

const SLOTS = [['breakfast', 'B'], ['lunch', 'L'], ['dinner', 'D']];

export function quickAdd() {
  openLibrarySheet(refresh);
}

function refresh() {
  if (viewRoot) render(viewRoot);
}

export async function render(viewEl) {
  viewRoot = viewEl;
  viewEl.innerHTML = '';
  setHeader('Meals', null,
    el('button', { class: 'header-action', onclick: () => openLibrarySheet(refresh) }, 'Library'));

  viewEl.append(el('div', { class: 'cal-nav' },
    el('button', { onclick: () => { weekStart = addDays(weekStart, -7); refresh(); } }, '‹'),
    el('button', {
      class: 'cal-title', style: 'color:var(--text)',
      onclick: () => { weekStart = mondayOf(todayISO()); refresh(); },
    }, `Week of ${fmtDate(weekStart)}`),
    el('button', { onclick: () => { weekStart = addDays(weekStart, 7); refresh(); } }, '›'),
  ));

  const [plan, groceryItems] = await Promise.all([
    api.get(`/api/meal-plan?start=${weekStart}`),
    api.get('/api/grocery/items'),
  ]);
  const bySlot = {};
  for (const p of plan) bySlot[`${p.date}|${p.slot}`] = p;

  const t = todayISO();
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const card = el('div', { class: 'card' });
    for (const [slot, letter] of SLOTS) {
      const entry = bySlot[`${d}|${slot}`];
      const value = entry ? (entry.meal_name || entry.custom_text) : null;
      card.append(el('div', { class: 'slot-row tappable', onclick: () => openSlotSheet(d, slot, entry, refresh) },
        el('span', { class: 'slot-label' }, letter),
        el('div', { class: 'slot-value' },
          value || el('span', { class: 'slot-empty' }, '＋ add')),
      ));
    }
    viewEl.append(el('div', { class: 'meal-day section', style: 'margin-top:16px' },
      el('div', { class: 'meal-day-title' + (d === t ? ' today-label' : '') },
        `${weekdayName(d)} · ${fmtDate(d)}` + (d === t ? ' · Today' : '')),
      card));
  }

  // Grocery lives on its own screen now — this is just the doorway + count.
  const left = groceryItems.filter((it) => !it.checked).length;
  viewEl.append(el('div', { class: 'section' },
    el('div', { class: 'section-label' }, 'Grocery'),
    el('div', { class: 'card' },
      el('div', {
        class: 'row tappable', onclick: () => { location.hash = '#/grocery'; },
      },
        el('span', { style: 'font-size:20px' }, '🛒'),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, 'Grocery list'),
          el('div', { class: 'row-sub' }, left ? `${left} still to buy` : 'All bought')),
        el('span', { style: 'color:var(--text-dim)' }, '›')))));
}

async function openSlotSheet(date, slot, entry, onSaved) {
  const meals = await api.get('/api/meals');
  const customInput = el('input', { type: 'text', placeholder: 'Or type anything…', value: entry?.custom_text || '' });

  const setSlot = async (payload) => {
    await api.put('/api/meal-plan', { date, slot, ...payload });
    closeSheet();
    onSaved();
  };

  const list = el('div', { class: 'card', style: 'box-shadow:none;max-height:40vh;overflow-y:auto' },
    meals.length
      ? meals.map((m) => el('div', {
          class: 'row tappable', onclick: () => setSlot({ meal_id: m.id, custom_text: null }),
        },
          el('div', { class: 'row-main' },
            el('div', { class: 'row-title' }, m.name),
            m.tags ? el('div', { class: 'row-sub' }, m.tags) : null)))
      : el('div', { class: 'empty' }, 'Library is empty — type below or add meals via Library.'));

  openSheet(`${weekdayName(date)} ${slot}`, el('div', {},
    list,
    el('form', {
      style: 'margin-top:12px',
      onsubmit: (e) => {
        e.preventDefault();
        const text = customInput.value.trim();
        if (text) setSlot({ meal_id: null, custom_text: text });
      },
    },
      el('div', { class: 'field' }, customInput),
      el('button', { class: 'btn-primary', type: 'submit' }, 'Set'),
      entry ? el('button', {
        type: 'button', class: 'btn-ghost',
        onclick: () => setSlot({ meal_id: null, custom_text: null }),
      }, 'Clear slot') : null,
    ),
  ));
}

async function openLibrarySheet(onChanged) {
  const meals = await api.get('/api/meals');
  const nameInput = el('input', { type: 'text', placeholder: 'New meal (e.g. Chicken tacos)' });
  const tagsInput = el('input', { type: 'text', placeholder: 'Tags: quick, dinner…' });

  const rows = meals.map((m) => el('div', { class: 'row' },
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, m.name),
      m.tags ? el('div', { class: 'row-sub' }, m.tags) : null),
    el('button', {
      class: 'text-btn danger',
      onclick: async () => {
        if (!(await confirmDialog(`Delete "${m.name}" from library?`))) return;
        await api.del(`/api/meals/${m.id}`);
        closeSheet();
        openLibrarySheet(onChanged);
      },
    }, 'Delete')));

  openSheet('Meal library', el('div', {},
    el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        if (!name) return;
        await api.post('/api/meals', { name, tags: tagsInput.value.trim() || null });
        toast(`Added ${name}`);
        closeSheet();
        openLibrarySheet(onChanged);
      },
    },
      el('div', { class: 'field-row' },
        el('div', { class: 'field', style: 'flex:2' }, nameInput),
        el('div', { class: 'field' }, tagsInput)),
      el('button', { class: 'btn-primary', type: 'submit' }, 'Add to library'),
    ),
    el('div', { class: 'card', style: 'box-shadow:none;margin-top:12px;max-height:45vh;overflow-y:auto' },
      rows.length ? rows : el('div', { class: 'empty' }, 'No meals saved yet.')),
  ));
}
