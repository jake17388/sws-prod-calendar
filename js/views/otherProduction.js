import { renderJobCard } from '../components/jobCard.js';

/** Stacks open Project Handoff jobs that do not yet have a production due date. */
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
      <p>Project Handoff jobs without an install-calendar entry. Open a job to view its production details or assign its production due date.</p>
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
      <div class="empty-state-subtitle">Every Project Handoff job is already on the production calendar.</div>
    `;
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'schedule-day-jobs other-production-jobs';
  unscheduled.forEach(job => list.appendChild(renderJobCard(job, false)));
  container.appendChild(list);
}

