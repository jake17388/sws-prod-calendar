import { monthGridDays, formatISO, isSameDay, groupByDueDate, DAY_NAMES, MONTH_NAMES } from '../dates.js';
import { renderJobChip } from '../components/jobCard.js';

const MAX_VISIBLE_PER_CELL = 3;

// Module-level (not per-render) so "expanded" survives the full re-renders
// that fire on every job update — otherwise checking off a job elsewhere
// would silently re-collapse any cell the user had opened.
const expandedDays = new Set();

/** @param {HTMLElement} container @param {Date} refDate @param {object[]} jobs */
export function renderMonth(container, refDate, jobs) {
  const days = monthGridDays(refDate);
  const today = new Date();
  const jobsByDate = groupByDueDate(jobs);

  const header = document.createElement('div');
  header.className = 'month-weekday-row';
  DAY_NAMES.forEach(d => { const c = document.createElement('div'); c.textContent = d; header.appendChild(c); });

  const grid = document.createElement('div');
  grid.className = 'month-grid';
  days.forEach(day => {
    const cell = document.createElement('div');
    const iso = formatISO(day);
    const outside = day.getMonth() !== refDate.getMonth();
    cell.className = `month-cell ${outside ? 'outside-month' : ''} ${isSameDay(day, today) ? 'is-today' : ''}`.trim();

    const dateLabel = document.createElement('div');
    dateLabel.className = 'cell-date';
    dateLabel.textContent = day.getDate() === 1 ? `${MONTH_NAMES[day.getMonth()].slice(0, 3)} ${day.getDate()}` : String(day.getDate());
    cell.appendChild(dateLabel);

    const dayJobs = jobsByDate[iso] || [];
    const isExpanded = expandedDays.has(iso);
    const jobsWrap = document.createElement('div');
    jobsWrap.className = 'month-cell-jobs';
    const visibleJobs = isExpanded ? dayJobs : dayJobs.slice(0, MAX_VISIBLE_PER_CELL);
    visibleJobs.forEach(job => jobsWrap.appendChild(renderJobChip(job)));

    if (dayJobs.length > MAX_VISIBLE_PER_CELL) {
      const toggle = document.createElement('button');
      toggle.className = 'month-cell-more';
      if (isExpanded) {
        toggle.textContent = 'See less';
        toggle.addEventListener('click', () => { expandedDays.delete(iso); renderMonth(container, refDate, jobs); });
      } else {
        toggle.textContent = `+${dayJobs.length - MAX_VISIBLE_PER_CELL} more`;
        toggle.addEventListener('click', () => { expandedDays.add(iso); renderMonth(container, refDate, jobs); });
      }
      jobsWrap.appendChild(toggle);
    }
    cell.appendChild(jobsWrap);
    grid.appendChild(cell);
  });

  container.innerHTML = '';
  container.appendChild(header);
  container.appendChild(grid);
}

export function monthRangeLabel(refDate) {
  return `${MONTH_NAMES[refDate.getMonth()]} ${refDate.getFullYear()}`;
}
