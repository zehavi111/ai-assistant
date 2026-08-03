// Password gate.
import { api } from '../api.js';
import { el, setHeader } from '../ui.js';

export const quickAdd = null;

export function render(viewEl) {
  setHeader('', '');
  const input = el('input', {
    type: 'password', placeholder: 'Password', autofocus: true,
    autocomplete: 'current-password', 'aria-label': 'Password',
  });
  const wrap = el('div', { class: 'login-wrap' },
    el('div', { class: 'login-icon' }, 'L'),
    el('h1', {}, 'Life OS'),
    el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api.post('/api/auth/login', { password: input.value });
          location.hash = '#/today';
        } catch {
          wrap.classList.remove('shake');
          void wrap.offsetWidth; // restart animation
          wrap.classList.add('shake');
          input.value = '';
          input.focus();
        }
      },
    },
      el('div', { class: 'field' }, input),
      el('button', { class: 'btn-primary', type: 'submit' }, 'Unlock'),
    ),
  );
  viewEl.append(wrap);
}
