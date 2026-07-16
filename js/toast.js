const TOAST_DURATION_MS = 3000;
const ICONS = { success: '✓', error: '!', info: 'i' };

/** @param {string} message @param {'success'|'error'|'info'} [type] */
export function showToast(message, type = 'success') {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${ICONS[type] || ICONS.info}</span><span class="toast-message"></span>`;
  el.querySelector('.toast-message').textContent = message;
  stack.appendChild(el);

  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }, TOAST_DURATION_MS);
}
