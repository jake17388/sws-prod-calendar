import { fetchProductionJobs, fetchTrackingVersion, updateSelf } from './api.js';
import { initAuth, currentUser, currentPin, currentDepartment, canManageUsers, canAssignDepartments, updateAuthProfile, signOut } from './auth.js';
import { getJobs, setJobs, subscribe } from './state.js';
import { closeJobDetail } from './components/jobDetail.js';
import { initUserManagement, openUserManagement } from './components/userManagement.js';
import { initDropboxSettings, refreshDropboxSettingsUI } from './components/dropboxSettings.js';
import { renderStatsBar } from './components/statsBar.js';
import { renderMonth, monthRangeLabel } from './views/month.js';
import { renderWeek, weekRangeLabel } from './views/week.js';
import { renderSchedule } from './views/schedule.js';
import { renderJobsToAssign, jobsToAssignRangeLabel } from './views/jobsToAssign.js';
import { addDays } from './dates.js';
import { showToast } from './toast.js';
import { setHeaderDimmed } from './headerDim.js';
import { loadCachedJobs, saveCachedJobs } from './jobsCache.js';

const VIEWS = {
  month: { render: renderMonth, label: monthRangeLabel, step: (d, dir) => new Date(d.getFullYear(), d.getMonth() + dir, 1) },
  week: { render: renderWeek, label: weekRangeLabel, step: (d, dir) => addDays(d, dir * 7) },
  schedule: { render: renderSchedule, label: () => 'Schedule', step: (d, dir) => addDays(d, dir * 30) },
  assign: { render: renderJobsToAssign, label: jobsToAssignRangeLabel, step: (d, dir) => addDays(d, dir * 30) },
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
  document.getElementById('view-btn-assign').classList.toggle('active', activeView === 'assign');
  if (activeView === 'schedule') {
    const anchor = container.querySelector('[data-scroll-anchor="true"]');
    if (anchor) anchor.scrollIntoView({ block: 'start' });
  }
}

function switchView(view) {
  activeView = view;
  renderActiveView();
}

// The tracking version this page last synced to — see fetchTrackingVersion()
// in api.js. Polling compares a fresh version read against this and only
// pulls the full job list (which re-hits CalendarApp + the tracking Sheet)
// when it's actually stale, so idle tabs cost one cheap Property read per
// poll tick instead of a full refetch.
let lastKnownVersion = 0;

function refreshJobs() {
  return fetchProductionJobs()
    .then(({ jobs, version }) => {
      setJobs(jobs);
      saveCachedJobs(currentDepartment(), jobs);
      lastKnownVersion = version;
      document.getElementById('header-count').textContent = `${jobs.length} job${jobs.length === 1 ? '' : 's'} shown`;
      document.getElementById('last-updated').textContent =
        `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    })
    .catch(() => {});
}

const POLL_INTERVAL_MS = 10000;
let pollTimer = null;

function checkForTrackingUpdate() {
  fetchTrackingVersion()
    .then(version => { if (version !== lastKnownVersion) refreshJobs(); })
    .catch(() => {});
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(checkForTrackingUpdate, POLL_INTERVAL_MS);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// The version this page load booted with — captured from version.json on
// first fetch, so it's always correct with nothing to manually keep in
// sync. Later checks compare a fresh fetch against this instead of a
// hardcoded constant that's easy to forget to bump on deploy.
let bootVersion = null;

function checkForUpdate(manual) {
  const checkBtn = document.getElementById('settings-check-btn');
  if (manual) checkBtn.textContent = 'Checking…';
  fetch('version.json', { cache: 'no-store' })
    .then(r => r.json())
    .then(data => {
      if (bootVersion === null) bootVersion = data.version;
      document.getElementById('settings-version-text').textContent = bootVersion || '';
      if (data.version && data.version !== bootVersion) {
        document.getElementById('update-banner').classList.add('show');
        if (manual) checkBtn.textContent = 'Update available — see banner above';
      } else if (manual) {
        checkBtn.textContent = "You're up to date";
        setTimeout(() => { checkBtn.textContent = 'Check for updates'; }, 2500);
      }
    })
    .catch(() => {
      if (manual) {
        checkBtn.textContent = 'Could not check — try again';
        setTimeout(() => { checkBtn.textContent = 'Check for updates'; }, 2500);
      }
    });
}

const ZOOM_STEPS = [80, 90, 100, 110, 125, 150];
const ZOOM_KEY = 'sws_prod_cal_zoom';
const savedZoomIdx = ZOOM_STEPS.indexOf(+localStorage.getItem(ZOOM_KEY));
let zoomIdx = savedZoomIdx !== -1 ? savedZoomIdx : ZOOM_STEPS.indexOf(100);

function applyZoom() {
  const pct = ZOOM_STEPS[zoomIdx];
  document.getElementById('view-area').style.zoom = pct / 100;
  document.getElementById('zoom-label').textContent = `${pct}%`;
  localStorage.setItem(ZOOM_KEY, pct);
}

function openSettings() {
  document.getElementById('settings-backdrop').classList.add('show');
  document.getElementById('settings-panel').classList.add('show');
  setHeaderDimmed(true);
  document.getElementById('my-account-name').value = currentUser() || '';
  document.getElementById('my-account-pin').value = currentPin() || '';
  document.getElementById('my-account-hint').textContent = '';
  refreshDropboxSettingsUI();
}
function closeSettings() {
  document.getElementById('settings-backdrop').classList.remove('show');
  document.getElementById('settings-panel').classList.remove('show');
  setHeaderDimmed(false);
}

function saveMyAccount() {
  const hint = document.getElementById('my-account-hint');
  const name = document.getElementById('my-account-name').value.trim();
  const pin = document.getElementById('my-account-pin').value.trim();
  if (!name) { hint.textContent = 'Name is required'; return; }
  if (!/^\d{4}$/.test(pin)) { hint.textContent = 'PIN must be 4 digits'; return; }
  hint.textContent = 'Saving…';
  updateSelf({ name, pin })
    .then(res => {
      if (!res.success) { hint.textContent = res.error || 'Failed to save'; return; }
      updateAuthProfile({ user: res.user.name, pin: res.user.pin });
      document.getElementById('user-badge').textContent = res.user.name;
      hint.textContent = 'Saved';
      showToast('Account details saved');
      setTimeout(() => { hint.textContent = ''; }, 1500);
    })
    .catch(() => { hint.textContent = 'Network error — try again'; });
}

function boot() {
  document.getElementById('user-badge').textContent = currentUser() || '';
  const deptBadge = document.getElementById('dept-badge');
  const department = currentDepartment();
  deptBadge.textContent = department || '';
  deptBadge.hidden = !department || department === 'Viewer';
  document.getElementById('settings-usermgmt-btn').hidden = !canManageUsers();
  document.getElementById('view-btn-assign').hidden = !canAssignDepartments();
  applyZoom();

  document.querySelectorAll('.view-switcher button').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.getElementById('view-btn-assign').addEventListener('click', () => switchView('assign'));
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
  document.getElementById('refresh-btn').addEventListener('click', refreshJobs);
  document.getElementById('job-detail-close').addEventListener('click', closeJobDetail);
  document.getElementById('job-detail-overlay').addEventListener('click', e => {
    if (e.target.id === 'job-detail-overlay') closeJobDetail();
  });

  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close-btn').addEventListener('click', closeSettings);
  document.getElementById('settings-backdrop').addEventListener('click', closeSettings);
  document.getElementById('settings-signout-btn').addEventListener('click', () => { closeSettings(); signOut(); });
  document.getElementById('settings-check-btn').addEventListener('click', () => checkForUpdate(true));
  document.getElementById('settings-usermgmt-btn').addEventListener('click', () => { closeSettings(); openUserManagement(); });
  document.getElementById('my-account-save-btn').addEventListener('click', saveMyAccount);
  initUserManagement();
  initDropboxSettings();
  document.getElementById('zoom-in-btn').addEventListener('click', () => {
    zoomIdx = Math.min(zoomIdx + 1, ZOOM_STEPS.length - 1);
    applyZoom();
  });
  document.getElementById('zoom-out-btn').addEventListener('click', () => {
    zoomIdx = Math.max(zoomIdx - 1, 0);
    applyZoom();
  });
  document.getElementById('zoom-reset-btn').addEventListener('click', () => {
    zoomIdx = ZOOM_STEPS.indexOf(100);
    applyZoom();
  });

  // A brand-new session with no cached jobs yet (or one whose cache aged
  // out) would otherwise show a blank view-area for however long the
  // network round-trip takes — this replaces that with an explicit loading
  // state, which the cache-seed or the real fetch below both immediately
  // overwrite by rendering real content.
  document.getElementById('view-area').innerHTML =
    '<div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-title">Loading jobs…</div></div>';

  subscribe(renderActiveView);
  subscribe(renderStatsBar);

  // Paint last-known jobs instantly from a local cache while the real
  // fetch is still in flight (it re-hits CalendarApp + the tracking Sheet,
  // which can take a few seconds) — refreshJobs() below reconciles with
  // fresh data as soon as it lands, same as a normal poll-triggered update.
  const cachedJobs = loadCachedJobs(currentDepartment());
  if (cachedJobs) setJobs(cachedJobs);

  refreshJobs().then(() => { if (document.visibilityState === 'visible') startPolling(); });
  checkForUpdate();
}

document.getElementById('update-reload-btn').addEventListener('click', () => {
  const url = new URL(window.location.href);
  url.searchParams.set('v', Date.now());
  window.location.href = url.toString();
});

// A home-screen PWA left open in the background is often resumed from a
// suspended in-memory instance rather than a real reload, so it never
// re-runs boot()'s one-time version check. Re-check whenever it regains
// focus/visibility so the update banner reliably shows up.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkForUpdate();
    checkForTrackingUpdate();
    startPolling();
  } else {
    stopPolling();
  }
});

// See sw.js — forces every fetch to the network so a deploy is never left
// partially stale by the browser/CDN cache.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

initAuth(boot);
