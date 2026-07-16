import { parseISO, isSameDay, groupByDueDate, DAY_NAMES, MONTH_NAMES } from '../dates.js';
import { renderJobCard } from '../components/jobCard.js';

/** @param {HTMLElement} container @param {Date} refDate @param {object[]} jobs */
export function renderJobsToAssign(container, refDate, jobs) {
  const today = new Date();
  const unassigned = jobs.filter(j => !j.completed && (!j.departments || !j.departments.length));
  const grouped = groupByDueDate(unassigned);
  const dueDates = Object.keys(grouped).sort();

  container.innerHTML = '';

  if (!dueDates.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <div class="empty-state-icon">✓</div>
      <div class="empty-state-title">All caught up</div>
      <div class="empty-state-subtitle">Every open job already has a department assigned.</div>
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

export function jobsToAssignRangeLabel() {
  return 'Jobs to Assign';
}
