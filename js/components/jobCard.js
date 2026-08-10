import { toggleComplete } from '../api.js';
import { patchJob } from '../state.js';
import { dueStateClass } from '../dueDate.js';
import { openJobDetail } from './jobDetail.js';
import { canMarkJobComplete, canSeeDepartmentBadges } from '../auth.js';
import { beginRequest, isLatestRequest } from '../requestSequence.js';
import { JOB_TAGS } from '../config.js';
import { escapeHtml } from '../lib/html.js';
import { showToast } from '../toast.js';

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
// ratio of). Turns green once every task is checked off, instead of
// disappearing — the point is a permanent, at-a-glance record of how many
// tasks are left (or that there are none), not a "still working on it"
// indicator.
function deptProgressHtml(job, dept) {
  const { done, total } = deptProgress(job, dept);
  if (!total) return '';
  const pct = Math.round((done / total) * 100);
  const complete = done === total;
  return `
    <span class="job-card-dept-progress" title="${done}/${total} tasks completed">
      <span class="job-card-dept-progress-bar"><span class="job-card-dept-progress-fill ${complete ? 'complete' : ''}" style="width:${pct}%"></span></span>
      <span class="job-card-dept-progress-text">${done}/${total}</span>
    </span>
  `;
}

// Right-side stack of rows — one per department this job is EVER assigned
// to (not just whoever currently has it — that used to be the scope here,
// but it meant the whole row vanished the instant a department finished
// its last task or the job got marked complete). Each row pairs a
// checklist-progress bar with a colored badge (see tokens.css's --dept-*
// variables), so a job with several departments running in parallel is
// scannable at a glance instead of one cramped comma-separated badge.
// Ordered by JOB_TAGS rather than however departments happens to be stored,
// so the stack doesn't reshuffle between renders.
//
// Every role sees the same thing. Production-department accounts used to get
// progress bars with no badges, on the reasoning that someone in Graphics
// already knows they're in Graphics — but a job assigned to three
// departments then showed them three unlabeled bars with no way to tell
// which was theirs. The badge is what makes the row readable, so everyone
// with a session gets it.
function departmentBadgeHtml(job) {
  if (!canSeeDepartmentBadges() || !job.departments || !job.departments.length) return '';
  const rows = JOB_TAGS
    .filter(tag => job.departments.includes(tag))
    .map(dept => {
      const progress = deptProgressHtml(job, dept);
      // A small red notification-style dot on the badge's corner — like an
      // app icon badge — marks a department as currently holding the job,
      // separate from (and on top of) the permanent progress/assignment
      // row itself. Ship-In never gets one — it has no real "currently has
      // it" concept of its own (see renderDepartmentEditor's self-heal
      // comment), it's just implicitly current for as long as it's needed.
      const isCurrent = dept !== 'Ship-In' && job.currentDepartments && job.currentDepartments.includes(dept);
      const badge = `<span class="job-card-dept-badge-wrap">
             <span class="job-card-dept-badge ${deptBadgeClass(dept)}">${escapeHtml(dept)}</span>
             ${isCurrent ? '<span class="job-card-dept-current-dot" title="Currently has it"></span>' : ''}
           </span>`;
      return `<div class="job-card-dept-row">${progress}${badge}</div>`;
    })
    .join('');
  return rows ? `<div class="job-card-dept-badges">${rows}</div>` : '';
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
      if (res.success) {
        patchJob(job.jobKey, { completed: res.completed, completedAt: res.completedAt, completedBy: res.completedBy });
      } else {
        patchJob(job.jobKey, { completed: prevCompleted });
        showToast(res.error || 'Failed to update job', 'error');
      }
    })
    .catch(() => {
      if (!isLatestRequest(requestKey, token)) return;
      patchJob(job.jobKey, { completed: prevCompleted }); // revert on failure
      showToast('Failed to update job — check your connection', 'error');
    });
}

/** Full card used in schedule/week day lists. @param {object} job @param {boolean} showCrew @param {(jobKey: string) => void} onOpen @returns {HTMLElement} */
export function renderJobCard(job, showCrew = true, onOpen = openJobDetail) {
  const el = document.createElement('div');
  const state = dueStateClass(job.dueDate, job.completed);
  el.className = `job-card ${state} ${job.completed ? 'completed' : ''}`.trim();
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `Open ${job.jobNum ? job.jobNum + ', ' : ''}${job.title}`);
  const canComplete = canMarkJobComplete();
  el.innerHTML = `
    ${canComplete ? `<button class="job-card-checkbox ${job.completed ? 'checked' : ''}" aria-label="Mark complete"></button>` : ''}
    <div class="job-card-body">
      <div class="job-card-title">${job.jobNum ? `${escapeHtml(job.jobNum)} — ` : ''}${escapeHtml(job.title)}</div>
      <div class="job-card-meta">
        ${showCrew ? `<span class="job-card-crew">${escapeHtml(crewLabel(job))}</span>` : ''}
      </div>
    </div>
    ${departmentBadgeHtml(job)}
  `;
  if (canComplete) {
    el.querySelector('.job-card-checkbox').addEventListener('click', e => {
      e.stopPropagation();
      handleCheckboxToggle(job);
    });
  }
  el.addEventListener('click', () => onOpen(job.jobKey));
  el.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(job.jobKey);
    }
  });
  return el;
}

/** Condensed chip used in month grid cells. @param {object} job @returns {HTMLElement} */
export function renderJobChip(job) {
  const el = document.createElement('div');
  const state = dueStateClass(job.dueDate, job.completed);
  el.className = `job-chip ${state} ${job.completed ? 'completed' : ''}`.trim();
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `Open ${job.jobNum ? job.jobNum + ', ' : ''}${job.title}`);
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
  el.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openJobDetail(job.jobKey);
    }
  });
  return el;
}
