import { fetchCommonTasks, saveCommonTasks as saveCommonTasksApi } from '../api.js';
import { JOB_TAGS } from '../config.js';
import { escapeHtml, escapeAttr } from '../lib/html.js';
import { showToast } from '../toast.js';
import { setHeaderDimmed } from '../headerDim.js';

let commonTasks = [];
let loadPromise = null;

export function commonTasksForDepartment(department) {
  return commonTasks.filter(task => task.allDepartments || task.departments.includes(department));
}

export function refreshCommonTasks() {
  if (loadPromise) return loadPromise;
  loadPromise = fetchCommonTasks()
    .then(tasks => {
      commonTasks = tasks;
      return tasks;
    })
    .finally(() => { loadPromise = null; });
  return loadPromise;
}

function departmentChoices(task) {
  return JOB_TAGS.map(department => `
    <label class="common-task-dept-choice">
      <input type="checkbox" value="${escapeAttr(department)}" ${task.departments.includes(department) ? 'checked' : ''} ${task.allDepartments ? 'disabled' : ''} />
      <span>${escapeHtml(department)}</span>
    </label>`).join('');
}

function readTaskRow(row) {
  const allDepartments = row.querySelector('.common-task-all').checked;
  return {
    id: row.dataset.id || '',
    text: row.querySelector('.common-task-text').value.trim(),
    allDepartments,
    departments: allDepartments
      ? []
      : [...row.querySelectorAll('.common-task-dept-choice input:checked')].map(input => input.value),
  };
}

function renderTaskList() {
  const list = document.getElementById('common-task-list');
  list.innerHTML = '';
  if (!commonTasks.length) {
    list.innerHTML = '<div class="common-task-empty">No common task buttons yet.</div>';
    return;
  }

  commonTasks.forEach(task => {
    const row = document.createElement('div');
    row.className = 'common-task-row';
    row.dataset.id = task.id || '';
    row.innerHTML = `
      <div class="common-task-row-top">
        <input class="common-task-text" type="text" maxlength="160" value="${escapeAttr(task.text)}" placeholder="Task button text" />
        <button class="common-task-remove" aria-label="Remove common task">&times;</button>
      </div>
      <label class="common-task-all-choice">
        <input class="common-task-all" type="checkbox" ${task.allDepartments ? 'checked' : ''} />
        <span>All Departments</span>
      </label>
      <div class="common-task-departments">${departmentChoices(task)}</div>`;

    row.querySelector('.common-task-all').addEventListener('change', event => {
      row.querySelectorAll('.common-task-dept-choice input').forEach(input => {
        input.disabled = event.target.checked;
      });
    });
    row.querySelector('.common-task-remove').addEventListener('click', () => {
      commonTasks = commonTasks.filter(item => item !== task);
      renderTaskList();
    });
    list.appendChild(row);
  });
}

function addTaskRow() {
  commonTasks.push({ id: '', text: '', allDepartments: true, departments: [] });
  renderTaskList();
  const inputs = document.querySelectorAll('.common-task-text');
  inputs[inputs.length - 1]?.focus();
}

function saveChanges() {
  const hint = document.getElementById('common-task-hint');
  const tasks = [...document.querySelectorAll('.common-task-row')].map(readTaskRow);
  if (tasks.some(task => !task.text)) { hint.textContent = 'Every button needs text.'; return; }
  if (tasks.some(task => !task.allDepartments && !task.departments.length)) {
    hint.textContent = 'Choose a department or All Departments for every button.';
    return;
  }
  hint.textContent = 'Saving…';
  saveCommonTasksApi(tasks)
    .then(result => {
      if (!result.success) { hint.textContent = result.error || 'Failed to save'; return; }
      commonTasks = result.tasks;
      renderTaskList();
      hint.textContent = 'Saved';
      showToast('Common task buttons saved');
    })
    .catch(() => { hint.textContent = 'Network error — try again'; });
}

export function openCommonTaskManagement() {
  document.getElementById('common-task-overlay').classList.add('open');
  setHeaderDimmed(true);
  document.getElementById('common-task-list').innerHTML = '<div class="common-task-empty">Loading…</div>';
  document.getElementById('common-task-hint').textContent = '';
  refreshCommonTasks()
    .then(renderTaskList)
    .catch(() => { document.getElementById('common-task-list').innerHTML = '<div class="common-task-empty">Failed to load common tasks.</div>'; });
}

export function closeCommonTaskManagement() {
  document.getElementById('common-task-overlay').classList.remove('open');
  setHeaderDimmed(false);
}

function returnToSettings() {
  closeCommonTaskManagement();
  window.dispatchEvent(new CustomEvent('open-settings'));
}

export function initCommonTaskManagement() {
  document.getElementById('common-task-back').addEventListener('click', returnToSettings);
  document.getElementById('common-task-add').addEventListener('click', addTaskRow);
  document.getElementById('common-task-save').addEventListener('click', saveChanges);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('common-task-overlay').classList.contains('open')) returnToSettings();
  });
}
