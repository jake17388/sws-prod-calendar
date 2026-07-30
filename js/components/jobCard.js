import { toggleComplete } from '../api.js';
import { patchJob } from '../state.js';
import { dueStateClass } from '../dueDate.js';
import { openJobDetail } from './jobDetail.js';
import { canMarkJobComplete, canSeeDepartmentBadges } from '../auth.js';
import { beginRequest, isLatestRequest } from '../requestSequence.js';
import { JOB_TAGS } from '../config.js';

function crewLabel(job) {
  return job.crew && job.crew.length ? job.crew.join('/') : 'Unassigned';
}

// class-safe slug for each department tag, e.g. "Ship-In" -> "ship-in"
const deptBadgeClass = dept => `job-card-dept-badge-${dept.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

function deptProgress(job, dept) {
  const items = (job.departmentChecklists && job.departmentChecklists[dept]) || [];
  const done = items.filter(i => i.done).length;
  return { done, total: items.length };
}

// Company Cam-style checklist progress bar, paired with a department's
// badge — empty when that department has no tasks yet (nothing to show a
// ratio of).
function deptProgressHtml(job, dept) {
  const { done, total } = deptProgress(job, dept);
  if (!total) return '';
  const pct = Math.round((done / total) * 100);
  return `
    <span class="job-card-dept-progress" title="${done}/${total} tasks completed">
      <span class="job-card-dept-progress-bar"><span class="job-card-dept-progress-fill" style="width:${pct}%"></span></span>
      <span class="job-card-dept-progress-text">${done}/${total}</span>
    </span>
  `;
}

// Right-side stack of rows — one per department CURRENTLY on the job (not
// the full set it'll eventually need), each a colored badge (see
// tokens.css's --dept-* variables) paired with a checklist-progress bar, so
// a job with several departments running in parallel is scannable at a
// glance instead of one cramped comma-separated badge. Ordered by JOB_TAGS
// rather than however currentDepartments happens to be stored, so the
// stack doesn't reshuffle between renders. Shown to everyone with a
// session, including production-department accounts — they now see every
// job their department is ever assigned (not just current ones), so
// another department's badge on the same job is useful context, not noise.
function departmentBadgeHtml(job) {
  if (!canSeeDepartmentBadges() || !job.currentDepartments || !job.currentDepartments.length) return '';
  const rows = JOB_TAGS
    .filter(tag => job.currentDepartments.includes(tag))
    .map(dept => `
      <div class="job-card-dept-row">
        ${deptProgressHtml(job, dept)}
        <span class="job-card-dept-badge ${deptBadgeClass(dept)}">${escapeHtml(dept)}</span>
      </div>
    `)
    .join('');
  return `<div class="job-card-dept-badges">${rows}</div>`;
}

function handleCheckboxToggle(job) {
  const nextCompleted = !job.completed;
  const prevCompleted = job.completed;
  // Rapid clicks fire overlapping requests whose responses can resolve out
  // of order — only the response matching the most recently fired toggle
  // for this job is allowed to touch state, so a slow stale response can't
  // silently flip the checkbox back.
  const requestKey = `job-complete:${job.jobKey}`;
  const token = beginRequest(requestKey);
  patchJob(job.jobKey, { completed: nextCompleted });
  toggleComplete(job.jobKey, nextCompleted)
    .then(res => {
      if (!isLatestRequest(requestKey, token)) return;
      if (res.success) patchJob(job.jobKey, { completed: res.completed, completedAt: res.completedAt, completedBy: res.completedBy });
    })
    .catch(() => {
      if (!isLatestRequest(requestKey, token)) return;
      patchJob(job.jobKey, { completed: prevCompleted }); // revert on failure
    });
}

/** Full card used in schedule/week day lists. @param {object} job @param {boolean} showCrew @param {(jobKey: string) => void} onOpen @returns {HTMLElement} */
export function renderJobCard(job, showCrew = true, onOpen = openJobDetail) {
  const el = document.createElement('div');
  const state = dueStateClass(job.dueDate, job.completed);
  el.className = `job-card ${state} ${job.completed ? 'completed' : ''}`.trim();
  const canComplete = canMarkJobComplete();
  el.innerHTML = `
    ${canComplete ? `<button class="job-card-checkbox ${job.completed ? 'checked' : ''}" aria-label="Mark complete"></button>` : ''}
    <div class="job-card-body">
      <div class="job-card-title">${job.jobNum ? `${job.jobNum} — ` : ''}${escapeHtml(job.title)}</div>
      <div class="job-card-meta">
        ${showCrew ? `<span class="job-card-crew">${crewLabel(job)}</span>` : ''}
      </div>
    </div>
    ${departmentBadgeHtml(job)}
  `;
  if (canComplete) {
    el.querySelector('.job-card-checkbox').addEventListener('click', e => {
      e.stopPropagation();
      handleCheckboxToggle(job, e.currentTarget);
    });
  }
  el.addEventListener('click', () => onOpen(job.jobKey));
  return el;
}

/** Condensed chip used in month grid cells. @param {object} job @returns {HTMLElement} */
export function renderJobChip(job) {
  const el = document.createElement('div');
  const state = dueStateClass(job.dueDate, job.completed);
  el.className = `job-chip ${state} ${job.completed ? 'completed' : ''}`.trim();
  el.title = `${job.jobNum ? job.jobNum + ' — ' : ''}${job.title} (${crewLabel(job)})`;
  const canComplete = canMarkJobComplete();
  el.innerHTML = `
    ${canComplete ? '<span class="job-chip-check"></span>' : ''}
    <span class="job-chip-text">
      <span class="job-chip-num">${escapeHtml(job.jobNum || job.title)}</span>
      <span class="job-chip-title">${job.jobNum ? ' ' + escapeHtml(job.title) : ''}</span>
    </span>
  `;
  if (canComplete) {
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
