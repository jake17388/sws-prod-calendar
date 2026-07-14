import { toggleComplete } from '../api.js';
import { fmtMD } from '../dates.js';
import { patchJob } from '../state.js';
import { dueStateClass } from '../dueDate.js';
import { progressBarHtml } from './progressBar.js';
import { openJobDetail } from './jobDetail.js';
import { canEditJobs } from '../auth.js';

function crewLabel(job) {
  return job.crew && job.crew.length ? job.crew.join('/') : 'Unassigned';
}

function flagBadges(job) {
  const badges = [];
  if (job.multiDay) badges.push('<span class="job-card-badge">multi-day</span>');
  if (job.multiJobEvent) badges.push('<span class="job-card-badge flag">multiple job #s</span>');
  return badges.join('');
}

function handleCheckboxToggle(job) {
  const nextCompleted = !job.completed;
  patchJob(job.jobKey, { completed: nextCompleted });
  toggleComplete(job.jobKey, nextCompleted)
    .then(res => {
      if (res.success) patchJob(job.jobKey, { completed: res.completed, completedAt: res.completedAt, completedBy: res.completedBy });
    })
    .catch(() => {
      patchJob(job.jobKey, { completed: job.completed }); // revert on failure
    });
}

/** Full card used in schedule/week day lists. @param {object} job @param {boolean} showCrew @returns {HTMLElement} */
export function renderJobCard(job, showCrew = true) {
  const el = document.createElement('div');
  const state = dueStateClass(job.dueDate, job.completed);
  el.className = `job-card ${state} ${job.completed ? 'completed' : ''}`.trim();
  el.innerHTML = `
    <button class="job-card-checkbox ${job.completed ? 'checked' : ''}" aria-label="Mark complete" ${canEditJobs() ? '' : 'disabled'}></button>
    <div class="job-card-body">
      <div class="job-card-title">${job.jobNum ? `${job.jobNum} — ` : ''}${escapeHtml(job.title)}</div>
      <div class="job-card-meta">
        ${showCrew ? `<span class="job-card-crew">${crewLabel(job)}</span>` : ''}
        <span>due ${fmtMD(job.dueDate)}</span>
        ${flagBadges(job)}
      </div>
      ${progressBarHtml(job.progressPct)}
    </div>
  `;
  if (canEditJobs()) {
    el.querySelector('.job-card-checkbox').addEventListener('click', e => {
      e.stopPropagation();
      handleCheckboxToggle(job, e.currentTarget);
    });
  }
  el.addEventListener('click', () => openJobDetail(job.jobKey));
  return el;
}

/** Condensed chip used in month grid cells. @param {object} job @returns {HTMLElement} */
export function renderJobChip(job) {
  const el = document.createElement('div');
  const state = dueStateClass(job.dueDate, job.completed);
  el.className = `job-chip ${state} ${job.completed ? 'completed' : ''}`.trim();
  el.title = `${job.jobNum ? job.jobNum + ' — ' : ''}${job.title} (${crewLabel(job)})`;
  el.innerHTML = `
    <span class="job-chip-check ${canEditJobs() ? '' : 'readonly'}"></span>
    <span class="job-chip-text">
      <span class="job-chip-num">${escapeHtml(job.jobNum || job.title)}</span>
      <span class="job-chip-title">${job.jobNum ? ' ' + escapeHtml(job.title) : ''}</span>
    </span>
  `;
  if (canEditJobs()) {
    el.querySelector('.job-chip-check').addEventListener('click', e => {
      e.stopPropagation();
      handleCheckboxToggle(job);
    });
  }
  el.addEventListener('click', () => openJobDetail(job.jobKey));
  return el;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
