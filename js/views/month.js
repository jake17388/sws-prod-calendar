import { monthGridDays, formatISO, isSameDay, DAY_NAMES, MONTH_NAMES } from '../dates.js';
import { renderJobChip } from '../components/jobCard.js';

const MAX_VISIBLE_PER_CELL = 3;

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
    const jobsWrap = document.createElement('div');
    jobsWrap.className = 'month-cell-jobs';
    dayJobs.slice(0, MAX_VISIBLE_PER_CELL).forEach(job => jobsWrap.appendChild(renderJobChip(job)));
    if (dayJobs.length > MAX_VISIBLE_PER_CELL) {
      const more = document.createElement('div');
      more.className = 'month-cell-more';
      more.textContent = `+${dayJobs.length - MAX_VISIBLE_PER_CELL} more`;
      jobsWrap.appendChild(more);
    }
    cell.appendChild(jobsWrap);
    grid.appendChild(cell);
  });

  container.innerHTML = '';
  container.appendChild(header);
  container.appendChild(grid);
}

function groupByDueDate(jobs) {
  const map = {};
  jobs.forEach(job => {
    (map[job.dueDate] = map[job.dueDate] || []).push(job);
  });
  return map;
}

export function monthRangeLabel(refDate) {
  return `${MONTH_NAMES[refDate.getMonth()]} ${refDate.getFullYear()}`;
}
