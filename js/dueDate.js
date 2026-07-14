import { DUE_SOON_DAYS } from './config.js';
import { parseISO } from './dates.js';

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
