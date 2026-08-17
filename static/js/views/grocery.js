// Grocery list: items grouped by section, checkable one at a time or a whole section.
import { api } from '../api.js';
import {
  el, openSheet, closeSheet, toast, confirmDialog, emptyState, checkbox, setHeader,
} from '../ui.js';
import { openSectionsSheetFor } from './tasks.js';

let viewRoot = null;
let addInput = null;
// The unsectioned group stays in the DOM so optimistic adds have a home.
let noneWrap = null;
let noneCard = null;
let renderSeq = 0;
const stale = (seq) => seq !== renderSeq;

export function quickAdd() {
  if (addInput) addInput.focus();
}

function refresh() {
  if (viewRoot) render(viewRoot);
}

function paint(rowEl, checked) {
  rowEl.classList.toggle('done', checked);
  rowEl.querySelector('.check')?.classList.toggle('checked', checked);
}

export async function render(viewEl) {
  const seq = ++renderSeq;
  viewRoot = viewEl;
  viewEl.innerHTML = '';

  // Chrome + the add field paint before any request — typing never waits.
  setHeader('Grocery', null, el('button', {
    class: 'header-action',
    onclick: () => openSectionsSheetFor('grocery', 'Grocery', refresh),
  }, '🗂 Sections'));

  addInput = el('input', { type: 'text', placeholder: '＋ Add item…' });
  const addForm = el('form', {
    class: 'field', style: 'margin-top:8px',
    onsubmit: (e) => {
      e.preventDefault();
      const name = addInput.value.trim();
      if (!name) return;
      addInput.value = '';
      addItem(name);
    },
  }, addInput);
  viewEl.append(addForm);

  const [items, sections] = await Promise.all([
    api.get('/api/grocery/items'),
    api.get('/api/sections?kind=grocery'),
  ]);
  if (stale(seq)) return;

  // Defined sections in order, then the unsectioned group (kept in the DOM even
  // when empty — new items land there without a re-render).
  const groups = [
    ...sections.map((s) => ({ key: s.id, label: s.name })),
    { key: null, label: sections.length ? 'Other' : 'Items' },
  ];

  for (const g of groups) {
    const mine = items.filter((it) => (it.section_id ?? null) === g.key);
    const card = el('div', { class: 'card' }, sortRows(mine).map(itemRow));
    const allChecked = mine.length > 0 && mine.every((it) => it.checked);
    const bulkBtn = el('button', {
      class: 'text-btn', type: 'button',
      onclick: () => {
        // Anything still unchecked → check the lot; otherwise clear the lot.
        const next = !!card.querySelector('.row:not(.done)');
        card.querySelectorAll('.row').forEach((r) => paint(r, next));
        mine.forEach((it) => { it.checked = next; });
        bulkBtn.textContent = next ? 'Uncheck all' : 'Check all';
        api.post('/api/grocery/check', { checked: next, section_id: g.key })
          .catch(() => refresh());
      },
    }, allChecked ? 'Uncheck all' : 'Check all');

    const wrap = el('div', { class: 'section' },
      el('div', { class: 'section-label' }, g.label, bulkBtn),
      card);
    if (!mine.length) wrap.style.display = 'none';
    if (g.key === null) { noneWrap = wrap; noneCard = card; }
    viewEl.append(wrap);
  }

  if (!items.length) {
    viewEl.append(emptyState('🛒', 'Nothing on the list. Add what you need to buy.'));
  }

  const bought = items.filter((it) => it.checked).length;
  if (bought) {
    viewEl.append(el('button', {
      class: 'btn-ghost', style: 'margin-top:20px',
      onclick: async () => {
        if (!(await confirmDialog(`Remove ${bought} bought item(s) from the list?`))) return;
        await api.post('/api/grocery/clear-checked');
        refresh();
      },
    }, `Clear bought (${bought})`));
  }
}

// Unchecked first — the basket sinks to the bottom of its section.
function sortRows(items) {
  return [...items].sort((a, b) => (a.checked === b.checked ? 0 : a.checked ? 1 : -1));
}

// Optimistic add: the row appears now, the POST catches up.
function addItem(name) {
  const it = { id: null, name, section_id: null, qty: null, checked: false };
  const row = itemRow(it);
  if (!noneCard) return;
  noneCard.append(row);
  noneWrap.style.display = '';
  api.post('/api/grocery/items', { name })
    .then((saved) => {
      it.id = saved.id;
      if (it.checked) api.patch(`/api/grocery/items/${it.id}`, { checked: true });
    })
    .catch(() => row.remove());
}

function itemRow(it) {
  let row;
  const toggle = () => {
    it.checked = !it.checked;
    paint(row, it.checked);
    if (!it.id) return; // still being created — the POST handler syncs it
    api.patch(`/api/grocery/items/${it.id}`, { checked: it.checked }).catch(() => {
      it.checked = !it.checked;
      paint(row, it.checked);
    });
  };
  row = el('div', {
    class: 'row tappable' + (it.checked ? ' done' : ''),
    onclick: () => { if (it.id) openItemSheet(it, refresh); },
  },
    checkbox(it.checked, toggle),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, it.name),
      it.qty ? el('div', { class: 'row-sub' }, it.qty) : null,
    ),
  );
  return row;
}

async function openItemSheet(item, onSaved) {
  const sections = await api.get('/api/sections?kind=grocery').catch(() => []);
  let sectionId = item.section_id ?? null;

  const nameInput = el('input', { type: 'text', value: item.name || '' });
  const qtyInput = el('input', { type: 'text', value: item.qty || '', placeholder: 'Qty / note (2 kg)' });
  const sectionGroup = sections.length ? el('div', { class: 'chip-group' },
    [[null, 'None'], ...sections.map((s) => [s.id, s.name])].map(([id, name]) =>
      el('button', {
        type: 'button', class: sectionId === id ? 'active' : '',
        onclick: (e) => {
          sectionId = id;
          sectionGroup.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          e.target.classList.add('active');
        },
      }, name))) : null;

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return;
      await api.patch(`/api/grocery/items/${item.id}`, {
        name, qty: qtyInput.value.trim() || null, section_id: sectionId,
      });
      closeSheet();
      onSaved();
    },
  },
    el('div', { class: 'field' }, el('label', {}, 'Item'), nameInput),
    el('div', { class: 'field' }, el('label', {}, 'Quantity'), qtyInput),
    sectionGroup ? el('div', { class: 'field' }, el('label', {}, 'Section'), sectionGroup) : null,
    el('button', { class: 'btn-primary', type: 'submit' }, 'Save'),
    el('button', {
      type: 'button', class: 'btn-ghost', style: 'color:var(--danger)',
      onclick: async () => {
        if (!(await confirmDialog(`Remove "${item.name}"?`))) return;
        await api.del(`/api/grocery/items/${item.id}`);
        closeSheet();
        toast('Removed');
        onSaved();
      },
    }, 'Delete'),
  );

  openSheet('Edit item', form);
}
