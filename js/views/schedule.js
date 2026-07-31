import { parseISO, isSameDay, groupByDueDate, DAY_NAMES, MONTH_NAMES } from '../dates.js';
import { renderJobCard } from '../components/jobCard.js';

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

/** @param {HTMLElement} container @param {Date} refDate @param {object[]} jobs */
export function renderSchedule(container, refDate, jobs) {
  const today = new Date();
  const grouped = groupByDueDate(jobs);
  const dueDates = Object.keys(grouped).sort();
  const openIso = firstOpenDueDate(jobs);

  container.innerHTML = '';

  if (!dueDates.length) {
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

  dueDates.forEach(iso => {
    const date = parseISO(iso);
    const group = document.createElement('div');
    group.className = 'schedule-day-group';
    // Two independent anchors, so app.js can choose which one a given render
    // should scroll to: entering the view (and "Today") goes to the oldest open
    // job; the prev/next arrows still step by date. They're separate attributes
    // rather than one, because the same day is often both.
    if (iso === openIso) group.dataset.openAnchor = 'true';
    if (isSameDay(date, refDate)) group.dataset.dateAnchor = 'true';

    const heading = document.createElement('div');
    heading.className = `schedule-day-heading ${isSameDay(date, today) ? 'is-today' : ''}`.trim();
    heading.innerHTML = `<span class="num">${date.getDate()}</span><span>${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}</span><span class="dow">${DAY_NAMES[date.getDay()]}</span>`;
    group.appendChild(heading);

    const jobsWrap = document.createElement('div');
    jobsWrap.className = 'schedule-day-jobs';
    grouped[iso].forEach(job => jobsWrap.appendChild(renderJobCard(job)));
    group.appendChild(jobsWrap);

    list.appendChild(group);
  });

  container.appendChild(list);
}
