// Study / deep-dive queue.
import { api } from '../api.js';
import {
  el, openSheet, closeSheet, confirmDialog, emptyState,
  setHeader, PRIORITY_NAMES,
} from '../ui.js';

let viewRoot = null;

export function quickAdd() {
  openStudySheet({}, refresh);
}

function refresh() {
  if (viewRoot) render(viewRoot);
}

const STATUS_LABELS = { in_progress: 'In progress', queued: 'Queued', done: 'Done' };

export async function render(viewEl) {
  viewRoot = viewEl;
  viewEl.innerHTML = '';
  setHeader('Study');

  const topics = await api.get('/api/study');
  if (!topics.length) {
    viewEl.append(emptyState('📚', 'What do you want to master next?', 'Add a topic', quickAdd));
    return;
  }

  for (const status of ['in_progress', 'queued', 'done']) {
    const items = topics.filter((t) => t.status === status);
    if (!items.length) continue;
    viewEl.append(el('div', { class: 'section' },
      el('div', { class: 'section-label' }, STATUS_LABELS[status]),
      el('div', { class: 'card' }, items.map((t) => topicRow(t)))));
  }
}

function topicRow(t) {
  return el('div', {
    class: `row tappable pri-${t.priority}` + (t.status === 'done' ? ' done' : ''),
    onclick: () => openStudySheet(t, refresh),
  },
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, t.title),
      t.notes ? el('div', { class: 'row-sub' }, t.notes.split('\n')[0]) : null,
    ),
    t.status === 'in_progress' ? el('span', { class: 'pill streak' }, 'now') : null,
  );
}

export function openStudySheet(t, onSaved) {
  const isNew = !t.id;
  let status = t.status || 'queued';
  let priority = t.priority || 0;

  const titleInput = el('input', { type: 'text', value: t.title || '', placeholder: 'Topic (e.g. Rust, ML basics)', autofocus: isNew });
  const notesInput = el('textarea', { placeholder: 'Notes, links, resources…' }, t.notes || '');

  const statusGroup = el('div', { class: 'chip-group' },
    [['queued', 'Queued'], ['in_progress', 'In progress'], ['done', 'Done']].map(([s, label]) =>
      el('button', {
        type: 'button', class: status === s ? 'active' : '',
        onclick: (e) => {
          status = s;
          statusGroup.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          e.target.classList.add('active');
        },
      }, label)));

  const priGroup = el('div', { class: 'chip-group' }, PRIORITY_NAMES.map((name, i) =>
    el('button', {
      type: 'button', class: priority === i ? 'active' : '',
      onclick: () => {
        priority = i;
        priGroup.querySelectorAll('button').forEach((b, j) => b.classList.toggle('active', j === i));
      },
    }, name)));

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const title = titleInput.value.trim();
      if (!title) return;
      const payload = { title, notes: notesInput.value.trim() || null, status, priority };
      if (isNew) await api.post('/api/study', payload);
      else await api.patch(`/api/study/${t.id}`, payload);
      closeSheet();
      onSaved();
    },
  },
    el('div', { class: 'field' }, titleInput),
    el('div', { class: 'field' }, el('label', {}, 'Status'), statusGroup),
    el('div', { class: 'field' }, el('label', {}, 'Priority'), priGroup),
    el('div', { class: 'field' }, el('label', {}, 'Notes'), notesInput),
    el('button', { class: 'btn-primary', type: 'submit' }, isNew ? 'Add' : 'Save'),
    !isNew ? el('button', {
      type: 'button', class: 'btn-ghost', style: 'color:var(--danger)',
      onclick: async () => {
        if (!(await confirmDialog(`Delete "${t.title}"?`))) return;
        await api.del(`/api/study/${t.id}`);
        closeSheet();
        onSaved();
      },
    }, 'Delete') : null,
  );

  openSheet(isNew ? 'New topic' : 'Edit topic', form);
}
