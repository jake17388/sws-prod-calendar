import { fetchArchivedJobs } from '../api.js';
import { openJobDetail } from '../components/jobDetail.js';
import { escapeAttr, escapeHtml } from '../lib/html.js';
import { registerArchivedJob } from '../state.js';

let results = null;
let loading = false;
let error = '';
let query = '';

function formatCompleted(job) {
  if (!job.completedAt) return 'Completion time unavailable';
  const date = new Date(job.completedAt);
  if (Number.isNaN(date.getTime())) return 'Completion time unavailable';
  const stamp = date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return `Completed ${stamp}${job.completedBy ? ` by ${job.completedBy}` : ''}`;
}

function enrichJob(job, activeJobs) {
  const active = (activeJobs || []).find(candidate => candidate.jobKey === job.jobKey);
  return active ? { ...job, ...active, completed: true } : job;
}

function renderResults(container, activeJobs) {
  const list = container.querySelector('.archive-results');
  const status = container.querySelector('.archive-status');
  if (loading) {
    status.textContent = 'Searching archived jobs…';
    return;
  }
  if (error) {
    status.textContent = error;
    status.classList.add('error');
    return;
  }
  const jobs = (results || []).map(job => enrichJob(job, activeJobs));
  status.textContent = jobs.length
    ? `${jobs.length} archived job${jobs.length === 1 ? '' : 's'} found`
    : (query ? 'No archived jobs matched that search.' : 'No completed jobs have been archived yet.');

  jobs.forEach(job => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'archive-result';
    button.setAttribute('aria-label', `Open ${job.jobNum || job.jobKey}, ${job.title}`);
    const notes = (job.notes || []).length;
    const tasks = Object.values(job.departmentChecklists || {}).reduce((total, items) => total + items.length, 0);
    button.innerHTML = `
      <span class="archive-result-main">
        <span class="archive-result-title"><strong>${escapeHtml(job.jobNum || job.jobKey)}</strong> — ${escapeHtml(job.title)}</span>
        <span class="archive-result-completed">${escapeHtml(formatCompleted(job))}</span>
      </span>
      <span class="archive-result-summary">${notes} note${notes === 1 ? '' : 's'} · ${tasks} task${tasks === 1 ? '' : 's'}</span>
      <span class="archive-result-arrow" aria-hidden="true">›</span>`;
    button.addEventListener('click', () => {
      registerArchivedJob(job);
      openJobDetail(job.jobKey);
    });
    list.appendChild(button);
  });
}

function load(container, activeJobs, nextQuery) {
  loading = true;
  error = '';
  query = nextQuery;
  renderArchive(container, null, activeJobs);
  fetchArchivedJobs(query)
    .then(jobs => { results = jobs; })
    .catch(err => {
      results = [];
      error = err && err.message === 'Search is too long'
        ? err.message
        : 'Could not load archived jobs — check your connection and try again.';
    })
    .finally(() => {
      loading = false;
      renderArchive(container, null, activeJobs);
    });
}

export function renderArchive(container, _refDate, activeJobs) {
  container.innerHTML = `
    <section class="archive-view" aria-labelledby="archive-heading">
      <div class="archive-heading">
        <div>
          <h2 id="archive-heading">Archived Jobs</h2>
          <p>Search completed project history by job number, title, notes, department, or person.</p>
        </div>
      </div>
      <form class="archive-search" role="search">
        <label for="archive-search-input">Search archived jobs</label>
        <div class="archive-search-row">
          <input id="archive-search-input" type="search" maxlength="80" value="${escapeAttr(query)}" placeholder="Job number, customer, note, or person" />
          <button type="submit" class="settings-action primary">Search</button>
        </div>
      </form>
      <div class="archive-status" role="status" aria-live="polite"></div>
      <div class="archive-results"></div>
    </section>`;

  container.querySelector('.archive-search').addEventListener('submit', event => {
    event.preventDefault();
    load(container, activeJobs, container.querySelector('#archive-search-input').value.trim());
  });
  renderResults(container, activeJobs);
  if (results === null && !loading) load(container, activeJobs, '');
}
