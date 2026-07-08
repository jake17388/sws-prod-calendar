import { APP_VERSION } from './config.js';
import { fetchProductionJobs } from './api.js';
import { initAuth, currentUser, signOut } from './auth.js';
import { getJobs, setJobs, subscribe } from './state.js';
import { closeJobDetail } from './components/jobDetail.js';
import { renderMonth, monthRangeLabel } from './views/month.js';
import { renderWeek, weekRangeLabel } from './views/week.js';
import { renderSchedule } from './views/schedule.js';
import { addDays } from './dates.js';

const VIEWS = {
  month: { render: renderMonth, label: monthRangeLabel, step: (d, dir) => new Date(d.getFullYear(), d.getMonth() + dir, 1) },
  week: { render: renderWeek, label: weekRangeLabel, step: (d, dir) => addDays(d, dir * 7) },
  schedule: { render: renderSchedule, label: () => 'Schedule', step: (d, dir) => addDays(d, dir * 30) },
};

let activeView = 'week';
let refDate = new Date();

function renderActiveView() {
  const view = VIEWS[activeView];
  const container = document.getElementById('view-area');
  view.render(container, refDate, getJobs());
  document.getElementById('current-range').textContent = view.label(refDate);
  document.querySelectorAll('.view-switcher button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === activeView);
  });
  if (activeView === 'schedule') {
    const anchor = container.querySelector('[data-scroll-anchor="true"]');
    if (anchor) anchor.scrollIntoView({ block: 'start' });
  }
}

function switchView(view) {
  activeView = view;
  renderActiveView();
}

function refreshJobs() {
  return fetchProductionJobs()
    .then(jobs => setJobs(jobs))
    .catch(() => {});
}

function boot() {
  document.getElementById('user-name').textContent = currentUser() || '';
  document.querySelectorAll('.view-switcher button').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.getElementById('nav-prev').addEventListener('click', () => {
    refDate = VIEWS[activeView].step(refDate, -1);
    renderActiveView();
  });
  document.getElementById('nav-next').addEventListener('click', () => {
    refDate = VIEWS[activeView].step(refDate, 1);
    renderActiveView();
  });
  document.getElementById('nav-today').addEventListener('click', () => {
    refDate = new Date();
    renderActiveView();
  });
  document.getElementById('sign-out-btn').addEventListener('click', signOut);
  document.getElementById('job-detail-close').addEventListener('click', closeJobDetail);
  document.getElementById('job-detail-overlay').addEventListener('click', e => {
    if (e.target.id === 'job-detail-overlay') closeJobDetail();
  });

  subscribe(renderActiveView);
  refreshJobs();
  checkForUpdate();
}

function checkForUpdate() {
  fetch('version.json', { cache: 'no-store' })
    .then(r => r.json())
    .then(data => {
      if (data.version && data.version !== APP_VERSION) {
        document.getElementById('update-banner').classList.add('show');
      }
    })
    .catch(() => {});
}

document.getElementById('update-reload-btn').addEventListener('click', () => {
  const url = new URL(window.location.href);
  url.searchParams.set('v', Date.now());
  window.location.href = url.toString();
});

initAuth(boot);
