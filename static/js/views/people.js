// People & follow-ups. Exports personRow for the Today dashboard.
import { api } from '../api.js';
import {
  el, openSheet, closeSheet, toast, confirmDialog, emptyState,
  setHeader, todayISO, fmtDate, daysBetween,
} from '../ui.js';

let viewRoot = null;

export function quickAdd() {
  openPersonSheet({}, refresh);
}

function refresh() {
  if (viewRoot) render(viewRoot);
}

export async function render(viewEl) {
  viewRoot = viewEl;
  viewEl.innerHTML = '';
  setHeader('People');

  const t = todayISO();
  const all = await api.get('/api/people');
  const due = all.filter((p) => p.followup_date && p.followup_date <= t)
    .sort((a, b) => (a.followup_date < b.followup_date ? -1 : 1));

  if (!all.length) {
    viewEl.append(emptyState('👋', 'Nobody here yet. Add the people you want to stay close to.', 'Add person', quickAdd));
    return;
  }

  if (due.length) {
    viewEl.append(el('div', { class: 'section' },
      el('div', { class: 'section-label' }, 'Due for follow-up'),
      el('div', { class: 'card' }, due.map((p) => personRow(p, refresh)))));
  } else {
    viewEl.append(el('div', { class: 'section' },
      el('div', { class: 'section-label' }, 'Due for follow-up'),
      emptyState('👌', "No follow-ups due. Everyone's covered.")));
  }

  viewEl.append(el('div', { class: 'section' },
    el('div', { class: 'section-label' }, 'Everyone'),
    el('div', { class: 'card' }, all.map((p) => everyoneRow(p)))));
}

// Row for follow-up lists (Today + due section): actions inline.
export function personRow(p, onChange) {
  const t = todayISO();
  return el('div', { class: 'row tappable', onclick: () => openPersonSheet(p, onChange) },
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, p.name),
      el('div', { class: 'row-sub' },
        [p.followup_note, p.followup_date && p.followup_date < t ? `since ${fmtDate(p.followup_date)}` : null]
          .filter(Boolean).join(' · ') || (p.contact_method === 'text' ? 'Send a text' : 'Give a call')),
    ),
    p.phone ? el('a', {
      class: 'icon-btn',
      href: (p.contact_method === 'text' ? 'sms:' : 'tel:') + p.phone,
      onclick: (e) => e.stopPropagation(),
    }, p.contact_method === 'text' ? '💬' : '📞') : null,
    el('button', {
      class: 'text-btn',
      onclick: async (e) => {
        e.stopPropagation();
        await api.post(`/api/people/${p.id}/contacted?date=${t}`);
        toast(`Marked contacted · ${p.name}`);
        onChange();
      },
    }, 'Done'),
    el('button', {
      class: 'text-btn', style: 'color:var(--text-dim)',
      onclick: (e) => { e.stopPropagation(); openSnoozeSheet(p, onChange); },
    }, 'Snooze'),
  );
}

function everyoneRow(p) {
  const t = todayISO();
  let sub = 'Never contacted';
  let stale = false;
  if (p.last_contacted) {
    const days = daysBetween(p.last_contacted, t);
    sub = days === 0 ? 'Contacted today' : `Last contacted ${days}d ago`;
    stale = days > 30;
  }
  return el('div', { class: 'row tappable', onclick: () => openPersonSheet(p, refresh) },
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, p.name),
      el('div', { class: 'row-sub', style: stale ? 'color:var(--danger)' : '' },
        [p.relation, sub].filter(Boolean).join(' · ')),
    ),
    p.phone ? el('a', {
      class: 'icon-btn',
      href: (p.contact_method === 'text' ? 'sms:' : 'tel:') + p.phone,
      onclick: (e) => e.stopPropagation(),
    }, p.contact_method === 'text' ? '💬' : '📞') : null,
  );
}

function openSnoozeSheet(p, onChange) {
  const opt = (label, days) => el('button', {
    onclick: async () => {
      await api.post(`/api/people/${p.id}/snooze`, { days });
      closeSheet();
      toast(`Snoozed ${label}`);
      onChange();
    },
  }, label);
  openSheet(`Snooze ${p.name}`, el('div', { class: 'chip-group', style: 'padding-bottom:16px' },
    opt('+1 day', 1), opt('+3 days', 3), opt('+1 week', 7), opt('+2 weeks', 14)));
}

export function openPersonSheet(p, onSaved) {
  const isNew = !p.id;
  const nameInput = el('input', { type: 'text', value: p.name || '', placeholder: 'Name', autofocus: isNew });
  const relationInput = el('input', { type: 'text', value: p.relation || '', placeholder: 'Friend, client…' });
  const phoneInput = el('input', { type: 'tel', value: p.phone || '', placeholder: '+1 555 123 4567' });
  const notesInput = el('textarea', { placeholder: 'Notes' }, p.notes || '');
  const followupInput = el('input', { type: 'date', value: p.followup_date || '' });
  const followupNoteInput = el('input', { type: 'text', value: p.followup_note || '', placeholder: 'What about? (e.g. ask about the trip)' });

  let method = p.contact_method || null;
  const methodGroup = el('div', { class: 'chip-group' },
    [['call', '📞 Call'], ['text', '💬 Text']].map(([m, label]) =>
      el('button', {
        type: 'button', class: method === m ? 'active' : '',
        onclick: (e) => {
          method = method === m ? null : m;
          methodGroup.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          if (method) e.target.classList.add('active');
        },
      }, label)));

  const moreWrap = el('div', { style: isNew ? 'display:none' : '' },
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', {}, 'Relation'), relationInput),
      el('div', { class: 'field' }, el('label', {}, 'Phone'), phoneInput)),
    el('div', { class: 'field' }, el('label', {}, 'Preferred contact'), methodGroup),
    el('div', { class: 'field' }, el('label', {}, 'Notes'), notesInput),
  );
  const moreToggle = isNew
    ? el('button', { type: 'button', class: 'more-options-toggle', onclick: () => { moreWrap.style.display = ''; moreToggle.remove(); } }, 'More options')
    : null;

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return;
      const payload = {
        name,
        relation: relationInput.value.trim() || null,
        phone: phoneInput.value.trim() || null,
        notes: notesInput.value.trim() || null,
        contact_method: method,
        followup_date: followupInput.value || null,
        followup_note: followupNoteInput.value.trim() || null,
      };
      if (isNew) await api.post('/api/people', payload);
      else await api.patch(`/api/people/${p.id}`, payload);
      closeSheet();
      onSaved();
    },
  },
    el('div', { class: 'field' }, nameInput),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', {}, 'Follow up on'), followupInput),
      el('div', { class: 'field' }, el('label', {}, 'About'), followupNoteInput)),
    moreToggle,
    moreWrap,
    el('button', { class: 'btn-primary', type: 'submit' }, isNew ? 'Add' : 'Save'),
    !isNew ? el('button', {
      type: 'button', class: 'btn-ghost', style: 'color:var(--danger)',
      onclick: async () => {
        if (!(await confirmDialog(`Delete ${p.name}?`))) return;
        await api.del(`/api/people/${p.id}`);
        closeSheet();
        onSaved();
      },
    }, 'Delete') : null,
  );

  openSheet(isNew ? 'New person' : p.name, form);
}
