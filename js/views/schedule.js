import { parseISO, isSameDay, groupByDueDate, DAY_NAMES, MONTH_NAMES } from '../dates.js';
import { renderJobCard } from '../components/jobCard.js';
import { partitionScheduleJobs } from './scheduleGroups.mjs';

let completedExpanded = false;

/**
 * The due date of the oldest job that still isn't done — an overdue one if
 * there is any, otherwise the next one coming up, however far out that is.
 * This is where the schedule opens to, rather than today: today is rarely the
 * useful place to land. If work is behind, the overdue jobs are above the fold
 * and easy to miss; if work is ahead, today is an empty gap and the next real
 * job is days below.
 * @param {object[]} jobs @returns {string|null} "YYYY-MM-DD", or null if nothing is open
 */
function firstOpenDueDate(jobs) {
  return jobs.reduce((oldest, job) => {
    if (job.completed || !job.dueDate) return oldest;
    return !oldest || job.dueDate < oldest ? job.dueDate : oldest;
  }, null);
}

/**
 * @param {HTMLElement} parent
 * @param {object[]} jobs
 * @param {Date} refDate
 * @param {Date} today
 * @param {{ includeAnchors?: boolean, openIso?: string|null }} options
 */
function appendDayGroups(parent, jobs, refDate, today, { includeAnchors = false, openIso = null } = {}) {
  const grouped = groupByDueDate(jobs);

  Object.keys(grouped).sort().forEach(iso => {
    const date = parseISO(iso);
    const group = document.createElement('div');
    group.className = 'schedule-day-group';
    if (includeAnchors && iso === openIso) group.dataset.openAnchor = 'true';
    if (includeAnchors && isSameDay(date, refDate)) group.dataset.dateAnchor = 'true';

    const heading = document.createElement('div');
    heading.className = `schedule-day-heading ${isSameDay(date, today) ? 'is-today' : ''}`.trim();
    heading.innerHTML = `<span class="num">${date.getDate()}</span><span>${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}</span><span class="dow">${DAY_NAMES[date.getDay()]}</span>`;
    group.appendChild(heading);

    const jobsWrap = document.createElement('div');
    jobsWrap.className = 'schedule-day-jobs';
    grouped[iso].forEach(job => jobsWrap.appendChild(renderJobCard(job)));
    group.appendChild(jobsWrap);

    parent.appendChild(group);
  });
}

/** @param {HTMLElement} container @param {Date} refDate @param {object[]} jobs */
export function renderSchedule(container, refDate, jobs) {
  const today = new Date();
  const { open, completed } = partitionScheduleJobs(jobs);
  const openIso = firstOpenDueDate(open);

  container.innerHTML = '';

  if (!jobs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-title">No production jobs in range</div>
      <div class="empty-state-subtitle">Jobs will appear here once they're pulled in from the install calendars.</div>
    `;
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'schedule-list';

  // Anchors only belong to active work. A collapsed completed job must never
  // become an invisible scroll target when entering or paging the schedule.
  appendDayGroups(list, open, refDate, today, { includeAnchors: true, openIso });

  if (!open.length) {
    const allDone = document.createElement('div');
    allDone.className = 'schedule-open-empty';
    allDone.textContent = 'No open production jobs in range.';
    list.appendChild(allDone);
  }

  if (completed.length) {
    const section = document.createElement('section');
    section.className = `schedule-completed-section ${completedExpanded ? 'is-expanded' : ''}`.trim();

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'schedule-completed-toggle';
    toggle.setAttribute('aria-expanded', String(completedExpanded));
    toggle.innerHTML = `
      <span class="schedule-completed-label">Completed jobs</span>
      <span class="schedule-completed-count">${completed.length}</span>
      <span class="schedule-completed-chevron" aria-hidden="true">⌄</span>
    `;

    const completedList = document.createElement('div');
    completedList.className = 'schedule-completed-list';
    completedList.hidden = !completedExpanded;
    appendDayGroups(completedList, completed, refDate, today);

    toggle.addEventListener('click', () => {
      completedExpanded = !completedExpanded;
      toggle.setAttribute('aria-expanded', String(completedExpanded));
      completedList.hidden = !completedExpanded;
      section.classList.toggle('is-expanded', completedExpanded);
    });

    section.append(toggle, completedList);
    list.appendChild(section);
  }

  container.appendChild(list);
}
