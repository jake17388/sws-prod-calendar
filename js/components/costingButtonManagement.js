import { fetchCostingButtons, saveCostingButtons as saveCostingButtonsApi } from '../api.js';
import { escapeAttr } from '../lib/html.js';
import { showToast } from '../toast.js';
import { setHeaderDimmed } from '../headerDim.js';

let costingButtons = null;
let loadPromise = null;
let editorBusy = false;

export const costingButtonsLoaded = () => costingButtons !== null;
export const costingButtonsForSelector = () => costingButtons || [];

function setEditorBusy(busy) {
  editorBusy = busy;
  document.getElementById('costing-button-add').disabled = busy;
  document.getElementById('costing-button-save').disabled = busy;
}

export function refreshCostingButtons(force = false) {
  if (loadPromise) return loadPromise;
  if (costingButtons !== null && !force) return Promise.resolve(costingButtons);
  loadPromise = fetchCostingButtons()
    .then(buttons => {
      costingButtons = buttons;
      return buttons;
    })
    .finally(() => { loadPromise = null; });
  return loadPromise;
}

function renderButtonList() {
  const list = document.getElementById('costing-button-list');
  list.innerHTML = '';
  if (!costingButtons?.length) {
    list.innerHTML = '<div class="costing-button-empty">No costing buttons configured.</div>';
    return;
  }
  costingButtons.forEach(button => {
    const row = document.createElement('div');
    row.className = 'costing-button-row';
    row.dataset.id = button.id || '';
    row.innerHTML = `<input class="costing-button-text" type="text" maxlength="80" value="${escapeAttr(button.text)}" placeholder="Costing activity" aria-label="Costing button name" />
      <button class="costing-button-remove" type="button" aria-label="Remove ${escapeAttr(button.text)}">&times;</button>`;
    row.querySelector('.costing-button-text').addEventListener('input', event => {
      button.text = event.target.value;
    });
    row.querySelector('.costing-button-remove').addEventListener('click', () => {
      costingButtons = costingButtons.filter(item => item !== button);
      renderButtonList();
    });
    list.appendChild(row);
  });
}

function addButtonRow() {
  if (editorBusy) return;
  costingButtons = [...(costingButtons || []), { id: '', text: '' }];
  renderButtonList();
  const inputs = document.querySelectorAll('.costing-button-text');
  inputs[inputs.length - 1]?.focus();
}

function saveChanges() {
  if (editorBusy) return;
  const hint = document.getElementById('costing-button-hint');
  const buttons = [...document.querySelectorAll('.costing-button-row')].map(row => ({
    id: row.dataset.id || '',
    text: row.querySelector('.costing-button-text').value.trim(),
  }));
  if (buttons.some(button => !button.text)) {
    hint.textContent = 'Every button needs a name.';
    return;
  }
  const normalized = buttons.map(button => button.text.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    hint.textContent = 'Button names must be unique.';
    return;
  }
  hint.textContent = 'Saving…';
  setEditorBusy(true);
  saveCostingButtonsApi(buttons)
    .then(result => {
      if (!result.success) { hint.textContent = result.error || 'Failed to save'; return; }
      costingButtons = result.buttons;
      renderButtonList();
      hint.textContent = 'Saved';
      showToast('Costing buttons saved');
    })
    .catch(() => { hint.textContent = 'Network error — try again'; })
    .finally(() => setEditorBusy(false));
}

export function openCostingButtonManagement() {
  document.getElementById('costing-button-overlay').classList.add('open');
  setHeaderDimmed(true);
  document.getElementById('costing-button-list').innerHTML = '<div class="costing-button-empty">Loading…</div>';
  document.getElementById('costing-button-hint').textContent = '';
  setEditorBusy(true);
  refreshCostingButtons(true)
    .then(() => {
      renderButtonList();
      setEditorBusy(false);
    })
    .catch(() => { document.getElementById('costing-button-list').innerHTML = '<div class="costing-button-empty">Failed to load costing buttons.</div>'; });
}

export function closeCostingButtonManagement() {
  document.getElementById('costing-button-overlay').classList.remove('open');
  setHeaderDimmed(false);
}

function returnToSettings() {
  closeCostingButtonManagement();
  window.dispatchEvent(new CustomEvent('open-settings'));
}

export function initCostingButtonManagement() {
  document.getElementById('costing-button-back').addEventListener('click', returnToSettings);
  document.getElementById('costing-button-add').addEventListener('click', addButtonRow);
  document.getElementById('costing-button-save').addEventListener('click', saveChanges);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('costing-button-overlay').classList.contains('open')) returnToSettings();
  });
}
