import { renderJobCard } from '../components/jobCard.js';
import { escapeHtml } from '../lib/html.js';

// Status names come from Squarecoil, not from us, so they are escaped before
// going anywhere near innerHTML.
/** Names the statuses actually present, so the intro reflects the current setting. */
function statusSummary(jobs) {
  const statuses = [...new Set(jobs.map(job => job.squarecoilStatus).filter(Boolean))];
  if (!statuses.length) return 'Squarecoil production jobs';
  if (statuses.length > 3) return `Jobs across ${statuses.length} Squarecoil statuses`;
  return `${escapeHtml(statuses.join(', '))} jobs`;
}

/**
 * Stacks open Squarecoil jobs — in whichever statuses an Admin has enabled
 * (Settings > Production Statuses) — that do not yet have a production due
 * date. Jobs already on the install calendar are filtered out server-side.
 */
export function renderOtherProduction(container, refDate, jobs) {
  const unscheduled = jobs
    .filter(job => job.isOtherProduction && !job.dueDate && !job.completed)
    .sort((a, b) => String(b.jobNum || '').localeCompare(String(a.jobNum || '')));

  container.innerHTML = '';

  const intro = document.createElement('section');
  intro.className = 'other-production-intro';
  intro.innerHTML = `
    <div>
      <h2>Other Production</h2>
      <p>${statusSummary(unscheduled)} without an install-calendar entry. Open a job to view its production details or assign its production due date.</p>
    </div>
    <span class="other-production-count">${unscheduled.length} unscheduled</span>
  `;
  container.appendChild(intro);

  if (!unscheduled.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <div class="empty-state-icon">✓</div>
      <div class="empty-state-title">No unscheduled production</div>
      <div class="empty-state-subtitle">Every Squarecoil production job is already on the production calendar.</div>
    `;
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'schedule-day-jobs other-production-jobs';
  unscheduled.forEach(job => list.appendChild(renderJobCard(job, false)));
  container.appendChild(list);
}

