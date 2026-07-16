import { dueStateClass } from '../dueDate.js';

/** Renders the at-a-glance status summary strip from the full loaded job list. @param {object[]} jobs */
export function renderStatsBar(jobs) {
  const el = document.getElementById('stats-bar');
  if (!el) return;

  const open = jobs.filter(j => !j.completed);
  const overdue = open.filter(j => dueStateClass(j.dueDate, false) === 'due-overdue').length;
  const dueSoon = open.filter(j => dueStateClass(j.dueDate, false) === 'due-soon').length;
  const onTrack = open.length - overdue - dueSoon;
  const completed = jobs.length - open.length;

  el.innerHTML = `
    <div class="stat-chip critical">
      <span class="stat-chip-dot"></span>
      <span class="stat-chip-value">${overdue}</span>
      <span class="stat-chip-label">Overdue</span>
    </div>
    <div class="stat-chip warning">
      <span class="stat-chip-dot"></span>
      <span class="stat-chip-value">${dueSoon}</span>
      <span class="stat-chip-label">Due soon</span>
    </div>
    <div class="stat-chip success">
      <span class="stat-chip-dot"></span>
      <span class="stat-chip-value">${onTrack}</span>
      <span class="stat-chip-label">On track</span>
    </div>
    <div class="stat-chip neutral">
      <span class="stat-chip-dot"></span>
      <span class="stat-chip-value">${completed}</span>
      <span class="stat-chip-label">Completed</span>
    </div>
    <div class="stats-bar-total">${jobs.length} job${jobs.length === 1 ? '' : 's'} tracked</div>
  `;
}
