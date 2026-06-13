// keyboard.js — minimal on-screen touch keyboard bound to an <input>.
// macOS does not raise a soft keyboard for an external touchscreen, so the
// search panel needs its own. Keys carry data-key for deterministic E2E.
const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

export function attachKeyboard(container, input, { onEnter } = {}) {
  container.classList.add('osk');
  container.replaceChildren();

  const emit = () => input.dispatchEvent(new Event('input', { bubbles: true }));
  const press = (ch) => {
    input.value += ch;
    emit();
  };

  for (const row of ROWS) {
    const r = el('div', 'osk-row');
    for (const ch of row) r.appendChild(key(ch, ch, () => press(ch)));
    container.appendChild(r);
  }

  const bottom = el('div', 'osk-row');
  bottom.appendChild(
    key('backspace', '⌫', () => {
      input.value = input.value.slice(0, -1);
      emit();
    }, 'osk-wide'),
  );
  bottom.appendChild(key('space', 'space', () => press(' '), 'osk-space'));
  bottom.appendChild(
    key('clear', 'clear', () => {
      input.value = '';
      emit();
    }, 'osk-wide'),
  );
  bottom.appendChild(
    key('enter', 'search', () => onEnter && onEnter(input.value), 'osk-go'),
  );
  container.appendChild(bottom);
}

function key(name, label, fn, extra = '') {
  const b = el('button', `osk-key ${extra}`.trim());
  b.type = 'button';
  b.textContent = label;
  b.setAttribute('data-key', name);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    fn();
  });
  return b;
}

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}
