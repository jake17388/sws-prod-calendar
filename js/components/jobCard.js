import { toggleComplete } from '../api.js';
import { patchJob } from '../state.js';
import { dueStateClass } from '../dueDate.js';
import { progressBarHtml } from './progressBar.js';
import { openJobDetail } from './jobDetail.js';

function crewLabel(job) {
  return job.crew && job.crew.length ? job.crew.join('/') : 'Unassigned';
}

function flagBadges(job) {
  const badges = [];
  if (job.multiDay) badges.push('<span class="job-card-badge">multi-day</span>');
  if (job.multiJobEvent) badges.push('<span class="job-card-badge flag">multiple job #s</span>');
  if (job.unmatched) badges.push('<span class="job-card-badge flag">no job #</span>');
  return badges.join('');
}

function handleCheckboxToggle(job, checkboxEl) {
  const nextCompleted = !job.completed;
  patchJob(job.jobKey, { completed: nextCompleted });
  toggleComplete(job.jobKey, nextCompleted).catch(() => {
    patchJob(job.jobKey, { completed: job.completed }); // revert on failure
  });
}

/** Full card used in schedule/week day lists. @param {object} job @returns {HTMLElement} */
export function renderJobCard(job) {
  const el = document.createElement('div');
  const state = dueStateClass(job.dueDate, job.completed);
  el.className = `job-card ${state} ${job.completed ? 'completed' : ''}`.trim();
  el.innerHTML = `
    <button class="job-card-checkbox ${job.completed ? 'checked' : ''}" aria-label="Mark complete"></button>
    <div class="job-card-body">
      <div class="job-card-title">${job.jobNum ? `#${job.jobNum} — ` : ''}${escapeHtml(job.title)}</div>
      <div class="job-card-meta">
        <span class="job-card-crew">${crewLabel(job)}</span>
        <span>due ${job.dueDate}</span>
        ${flagBadges(job)}
      </div>
      ${progressBarHtml(job.progressPct)}
    </div>
  `;
  el.querySelector('.job-card-checkbox').addEventListener('click', e => {
    e.stopPropagation();
    handleCheckboxToggle(job, e.currentTarget);
  });
  el.addEventListener('click', () => openJobDetail(job.jobKey));
  return el;
}

/** Condensed chip used in month grid cells. @param {object} job @returns {HTMLElement} */
export function renderJobChip(job) {
  const el = document.createElement('div');
  const state = dueStateClass(job.dueDate, job.completed);
  el.className = `job-chip ${state} ${job.completed ? 'completed' : ''}`.trim();
  el.title = `${job.jobNum ? '#' + job.jobNum + ' — ' : ''}${job.title} (${crewLabel(job)})`;
  el.innerHTML = `<span class="job-chip-check"></span><span>${job.jobNum ? '#' + job.jobNum + ' ' : ''}${escapeHtml(job.title)}</span>`;
  el.querySelector('.job-chip-check').addEventListener('click', e => {
    e.stopPropagation();
    handleCheckboxToggle(job);
  });
  el.addEventListener('click', () => openJobDetail(job.jobKey));
  return el;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
