import { fetchProductionStatuses, saveProductionStatuses as saveProductionStatusesApi } from '../api.js';
import { escapeAttr, escapeHtml } from '../lib/html.js';
import { showToast } from '../toast.js';
import { setHeaderDimmed } from '../headerDim.js';

let settings = null;
let editorBusy = false;

const list = () => document.getElementById('production-status-list');
const hint = () => document.getElementById('production-status-hint');

function setEditorBusy(busy) {
  editorBusy = busy;
  document.getElementById('production-status-save').disabled = busy;
}

/**
 * Enabled statuses first, in the order they were saved — that order decides
 * which status a job is filed under when two Squarecoil reports both list it.
 * Everything else Squarecoil offers follows, unchecked.
 */
function statusRows() {
  const enabled = settings.statuses;
  const enabledKeys = new Set(enabled.map(status => status.toLowerCase()));
  const rest = settings.available.filter(status => !enabledKeys.has(status.toLowerCase()));
  const unresolved = new Set(settings.unresolved.map(status => status.toLowerCase()));
  return [
    ...enabled.map(status => ({ status, checked: true, unresolved: unresolved.has(status.toLowerCase()) })),
    ...rest.map(status => ({ status, checked: false, unresolved: false })),
  ];
}

function renderStatusList() {
  const rows = statusRows();
  list().innerHTML = '';
  if (!rows.length) {
    list().innerHTML = '<div class="production-status-empty">No Squarecoil statuses are available.</div>';
    return;
  }
  rows.forEach(row => {
    const label = document.createElement('label');
    label.className = 'production-status-row';
    label.innerHTML = `
      <input type="checkbox" class="production-status-checkbox" value="${escapeAttr(row.status)}" ${row.checked ? 'checked' : ''} />
      <span class="production-status-name">${escapeHtml(row.status)}</span>
      ${row.unresolved ? '<span class="production-status-warning">No matching Squarecoil milestone — no jobs will load</span>' : ''}
    `;
    list().appendChild(label);
  });
}

function saveChanges() {
  if (editorBusy) return;
  const statuses = [...document.querySelectorAll('.production-status-checkbox')]
    .filter(box => box.checked)
    .map(box => box.value);

  hint().textContent = 'Saving…';
  setEditorBusy(true);
  saveProductionStatusesApi(statuses)
    .then(result => {
      if (!result.success) { hint().textContent = result.error || 'Failed to save'; return; }
      settings = { ...settings, statuses: result.statuses };
      renderStatusList();
      hint().textContent = 'Saved — jobs refresh within a few minutes';
      showToast('Production statuses saved');
    })
    .catch(() => { hint().textContent = 'Network error — try again'; })
    .finally(() => setEditorBusy(false));
}

export function openProductionStatusManagement() {
  document.getElementById('production-status-overlay').classList.add('open');
  setHeaderDimmed(true);
  list().innerHTML = '<div class="production-status-empty">Loading…</div>';
  hint().textContent = '';
  setEditorBusy(true);
  return fetchProductionStatuses()
    .then(loaded => {
      settings = loaded;
      renderStatusList();
      if (loaded.error) hint().textContent = loaded.error;
      setEditorBusy(false);
    })
    .catch(() => {
      list().innerHTML = '<div class="production-status-empty">Failed to load production statuses.</div>';
    });
}

export function closeProductionStatusManagement() {
  document.getElementById('production-status-overlay').classList.remove('open');
  setHeaderDimmed(false);
}

function returnToSettings() {
  closeProductionStatusManagement();
  window.dispatchEvent(new CustomEvent('open-settings'));
}

export function initProductionStatusManagement() {
  document.getElementById('production-status-back').addEventListener('click', returnToSettings);
  document.getElementById('production-status-save').addEventListener('click', saveChanges);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('production-status-overlay').classList.contains('open')) returnToSettings();
  });
}
