export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** @param {string} iso "YYYY-MM-DD" @returns {Date} local-time midnight */
export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** @param {string} iso "YYYY-MM-DD" @returns {string} "MM/DD" */
export const fmtMD = iso => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;

/** @param {Date} date @returns {string} "YYYY-MM-DD" */
export function formatISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function startOfWeek(date) {
  return addDays(date, -date.getDay());
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** First Sunday on/before the 1st through the last Saturday on/after month end — a full 7-col grid. */
export function monthGridDays(date) {
  const first = startOfMonth(date);
  const gridStart = startOfWeek(first);
  const days = [];
  for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));
  return days;
}

/** @param {Date} date @returns {boolean} true for Saturday or Sunday */
export const isWeekend = date => date.getDay() === 0 || date.getDay() === 6;

// The production TV strip: one look-back work day, today, and the next three
// work days. Weekend days inside that span ride along as slivers rather than
// being dropped, so the run of dates stays continuous and today always reads
// as the second substantial column.
const TV_LOOKAHEAD_WORK_DAYS = 3;
export const TV_DAY_TRACK = 'minmax(0, 1fr)';
export const TV_WEEKEND_TRACK = '34px';

/** @param {Date} date @returns {Date[]} contiguous days covering the TV window */
export function tvWindowDays(date) {
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  let start = addDays(today, -1);
  while (isWeekend(start)) start = addDays(start, -1);
  let end = today;
  for (let i = 0; i < TV_LOOKAHEAD_WORK_DAYS; i++) {
    do {
      end = addDays(end, 1);
    } while (isWeekend(end));
  }
  const days = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

/** @param {boolean[]} collapsed one flag per day @returns {string} grid-template-columns */
export const tvColumnTemplate = collapsed =>
  collapsed.map(isCollapsed => (isCollapsed ? TV_WEEKEND_TRACK : TV_DAY_TRACK)).join(' ');

export function weekDays(date) {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** @param {object[]} jobs @returns {Record<string, object[]>} jobs keyed by their dueDate */
export function groupByDueDate(jobs) {
  const map = {};
  jobs.forEach(job => {
    (map[job.dueDate] = map[job.dueDate] || []).push(job);
  });
  return map;
}

/** @param {string} name @returns {string} "First L" — used for compact "completed by" attribution */
export const abbreviateName = name => {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}` : name;
};

/** @param {string} iso full ISO timestamp @returns {string} "M/D h:mm AM/PM" */
export const formatTimestamp = iso => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
};
