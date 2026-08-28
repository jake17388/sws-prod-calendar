import { weekDays, tvWindowDays, tvColumnTemplate, isWeekend, formatISO, isSameDay, groupByDueDate, DAY_NAMES, MONTH_NAMES } from '../dates.js';
import { isTvDisplay } from '../auth.js';
import { renderJobCard } from '../components/jobCard.js';

/** The production TV rolls a work-day window; everyone else gets the calendar week. */
const viewDays = refDate => (isTvDisplay() ? tvWindowDays(refDate) : weekDays(refDate));

/** @param {HTMLElement} container @param {Date} refDate @param {object[]} jobs */
export function renderWeek(container, refDate, jobs) {
  const days = viewDays(refDate);
  const tv = isTvDisplay();
  const today = new Date();
  const jobsByDate = groupByDueDate(jobs);
  const collapsed = [];

  const grid = document.createElement('div');
  grid.className = 'week-grid';
  days.forEach(day => {
    const iso = formatISO(day);
    const isToday = isSameDay(day, today);
    const dayJobs = jobsByDate[iso] || [];
    // Weekends only collapse to a sliver when nothing is actually due on them —
    // an occasional Saturday job still gets a readable column.
    const isCollapsed = tv && isWeekend(day) && !dayJobs.length;
    collapsed.push(isCollapsed);

    const col = document.createElement('div');
    col.className = `week-day-col ${isToday ? 'is-today' : ''} ${isCollapsed ? 'is-collapsed' : ''}`.trim();

    const headerEl = document.createElement('div');
    headerEl.className = `week-day-header ${isToday ? 'is-today' : ''}`.trim();
    headerEl.innerHTML = `<div class="dow">${DAY_NAMES[day.getDay()]}</div><div class="dom">${day.getDate()}</div>`;
    col.appendChild(headerEl);

    const jobsWrap = document.createElement('div');
    jobsWrap.className = 'week-day-jobs';
    jobsWrap.style.setProperty('--tv-day-jobs', String(Math.max(dayJobs.length, 1)));
    if (!dayJobs.length) {
      jobsWrap.innerHTML = isCollapsed ? '' : '<div class="week-day-empty">—</div>';
    } else {
      dayJobs.forEach(job => jobsWrap.appendChild(renderJobCard(job, false)));
    }
    col.appendChild(jobsWrap);
    grid.appendChild(col);
  });

  // The TV window varies in length as the weekend enters and leaves it, so its
  // track sizing is computed per render rather than read from the shared token.
  if (tv) grid.style.setProperty('--week-cols', tvColumnTemplate(collapsed));

  container.innerHTML = '';
  container.appendChild(grid);
}

export function weekRangeLabel(refDate) {
  const days = viewDays(refDate);
  const start = days[0], end = days[days.length - 1];
  const sameMonth = start.getMonth() === end.getMonth();
  const startLabel = `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()}`;
  const endLabel = sameMonth ? `${end.getDate()}` : `${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getDate()}`;
  return `${startLabel} – ${endLabel}`;
}
