import { weekDays, formatISO, isSameDay, DAY_NAMES, MONTH_NAMES } from '../dates.js';
import { renderJobCard } from '../components/jobCard.js';

/** @param {HTMLElement} container @param {Date} refDate @param {object[]} jobs */
export function renderWeek(container, refDate, jobs) {
  const days = weekDays(refDate);
  const today = new Date();
  const jobsByDate = groupByDueDate(jobs);

  const grid = document.createElement('div');
  grid.className = 'week-grid';
  days.forEach(day => {
    const iso = formatISO(day);
    const col = document.createElement('div');
    col.className = 'week-day-col';

    const isToday = isSameDay(day, today);
    const headerEl = document.createElement('div');
    headerEl.className = `week-day-header ${isToday ? 'is-today' : ''}`.trim();
    headerEl.innerHTML = `<div class="dow">${DAY_NAMES[day.getDay()]}</div><div class="dom">${day.getDate()}</div>`;
    col.appendChild(headerEl);

    const jobsWrap = document.createElement('div');
    jobsWrap.className = 'week-day-jobs';
    const dayJobs = jobsByDate[iso] || [];
    if (!dayJobs.length) {
      jobsWrap.innerHTML = '';
    } else {
      dayJobs.forEach(job => jobsWrap.appendChild(renderJobCard(job)));
    }
    col.appendChild(jobsWrap);
    grid.appendChild(col);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

function groupByDueDate(jobs) {
  const map = {};
  jobs.forEach(job => {
    (map[job.dueDate] = map[job.dueDate] || []).push(job);
  });
  return map;
}

export function weekRangeLabel(refDate) {
  const days = weekDays(refDate);
  const start = days[0], end = days[6];
  const sameMonth = start.getMonth() === end.getMonth();
  const startLabel = `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()}`;
  const endLabel = sameMonth ? `${end.getDate()}` : `${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getDate()}`;
  return `${startLabel} – ${endLabel}`;
}
