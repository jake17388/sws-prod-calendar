import { DUE_SOON_DAYS } from './config.js';
import { parseISO, formatISO } from './dates.js';

/**
 * Mirrors Code.js's subtractBusinessDays — used only for optimistic client
 * math. The server-computed `dueDate` on each job is the source of truth.
 */
export function subtractBusinessDays(date, n) {
  const d = new Date(date);
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d;
}

export const dueDateFor = startDateIso => formatISO(subtractBusinessDays(parseISO(startDateIso), DUE_SOON_DAYS));

/** @returns {'due-overdue'|'due-soon'|''} CSS state class for a job's due date */
export function dueStateClass(dueDateIso, completed) {
  if (completed) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = parseISO(dueDateIso);
  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays < 0) return 'due-overdue';
  if (diffDays <= DUE_SOON_DAYS) return 'due-soon';
  return '';
}
