import { fetchProductionJobs, fetchTrackingVersion, updateSelf } from './api.js';
import { initAuth, currentUser, currentUserId, currentDepartment, canManageUsers, canAssignDepartments, canManageCostingButtons, canManageProductionStatuses, canUseJobSelector, canViewHoursLog, canViewOtherProduction, updateAuthProfile, signOut, isAdmin, mustChangePin, isTvDisplay } from './auth.js';
import { getJobs, setJobs, subscribe } from './state.js';
import { closeJobDetail, closeProofViewer } from './components/jobDetail.js';
import { preloadPdfViewer } from './pdfViewer.js';
import { preloadCurrentAndNextWeekProofs } from './currentWeekProofPreload.mjs';
import { initUserManagement, openUserManagement } from './components/userManagement.js';
import { initSquarecoilSettings, refreshSquarecoilSettingsUI } from './components/squarecoilSettings.js';
import { initCommonTaskManagement, openCommonTaskManagement, refreshCommonTasks } from './components/commonTaskManagement.js';
import { initCostingButtonManagement, openCostingButtonManagement } from './components/costingButtonManagement.js';
import { initProductionStatusManagement, openProductionStatusManagement } from './components/productionStatusManagement.js';
import { renderStatsBar } from './components/statsBar.js';
import { renderMonth, monthRangeLabel } from './views/month.js';
import { renderWeek, weekRangeLabel } from './views/week.js';
import { renderSchedule } from './views/schedule.js';
import { renderJobsToAssign, jobsToAssignRangeLabel } from './views/jobsToAssign.js';
import { renderJobSelector, jobSelectorRangeLabel, resetJobSelectorStatus } from './views/jobSelector.js';
import { renderHoursLog, hoursLogRangeLabel, resetHoursLog } from './views/hoursLog.js';
import { renderArchive } from './views/archive.js';
import { renderOtherProduction } from './views/otherProduction.js';
import { addDays } from './dates.js';
import { showToast } from './toast.js';
import { setHeaderDimmed } from './headerDim.js';
import { loadCachedJobs, saveCachedJobs } from './jobsCache.js';
import { reportSyncSuccess, reportSyncFailure, setOnFirstFailure } from './syncStatus.js';
import { hasPendingWrites, subscribePendingWrites } from './pendingWrites.mjs';
import { initSystemHealth, refreshSystemHealthUI } from './components/systemHealth.js';
import { cleanUpdateUrl, updateReloadUrl } from './updateUrl.mjs';

const cleanLoadedUrl = cleanUpdateUrl(window.location.href);
if (cleanLoadedUrl !== window.location.href) {
  window.history.replaceState(window.history.state, '', cleanLoadedUrl);
}

const VIEWS = {
  month: { render: renderMonth, label: monthRangeLabel, step: (d, dir) => new Date(d.getFullYear(), d.getMonth() + dir, 1) },
  week: { render: renderWeek, label: weekRangeLabel, step: (d, dir) => addDays(d, dir * 7) },
  schedule: { render: renderSchedule, label: () => 'Schedule', step: (d, dir) => addDays(d, dir * 30) },
  assign: { render: renderJobsToAssign, label: jobsToAssignRangeLabel, step: (d, dir) => addDays(d, dir * 30) },
  jobSelector: { render: renderJobSelector, label: jobSelectorRangeLabel, step: d => d },
  hoursLog: { render: renderHoursLog, label: hoursLogRangeLabel, step: d => d },
  archive: { render: renderArchive, label: () => 'Archive', step: d => d },
  otherProduction: { render: renderOtherProduction, label: () => 'Other Production', step: d => d },
};

function isJobDetailOpen() {
  return document.getElementById('job-detail-overlay')?.classList.contains('open') || false;
}

function renderPendingWriteStatus(pending = hasPendingWrites()) {
  const status = document.getElementById('save-status');
  if (!status) return;
  // Job starts/stops and manager edits paint optimistically in their own
  // screens. Keep backend activity out of the way while those interactions
  // are already visibly reflected in place.
  const showStatus = pending && activeView !== 'jobSelector' && !isJobDetailOpen();
  status.hidden = !showStatus;
  status.textContent = pending ? 'Saving…' : '';
}

subscribePendingWrites(renderPendingWriteStatus);

window.addEventListener('beforeunload', event => {
  if (!hasPendingWrites()) return;
  event.preventDefault();
  event.returnValue = '';
});

const DEFAULT_VIEW_KEY = 'sws_prod_cal_default_view';
const DEFAULT_VIEW = 'schedule';
const defaultViewKey = () => `${DEFAULT_VIEW_KEY}:${currentUserId() || currentUser() || 'anonymous'}`;
function canOpenView(view) {
  return ['month', 'week', 'schedule', 'archive'].includes(view)
    || (view === 'assign' && canAssignDepartments())
    || (view === 'otherProduction' && canViewOtherProduction())
    || (view === 'jobSelector' && canUseJobSelector())
    || (view === 'hoursLog' && canViewHoursLog());
}
function getDefaultView() {
  const saved = localStorage.getItem(defaultViewKey());
  return saved && canOpenView(saved) ? saved : DEFAULT_VIEW;
}
function saveDefaultView(view) {
  if (!canOpenView(view)) return;
  localStorage.setItem(defaultViewKey(), view);
}

let activeView = DEFAULT_VIEW;
let refDate = new Date();
let tvDayKey = '';

function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function configureHeaderForRole() {
  const tv = isTvDisplay();
  document.body.classList.toggle('tv-mode', tv);
  const toolbar = document.querySelector('.toolbar-left');
  const cluster = document.querySelector('.header-user-cluster');
  const updated = document.getElementById('last-updated');
  const sync = document.getElementById('sync-status');
  const saving = document.getElementById('save-status');
  const count = document.getElementById('header-count');
  const refresh = document.getElementById('refresh-btn');
  const user = document.getElementById('user-badge');

  if (tv) {
    // At-a-glance status, then Refresh, then Prod TV — all on the top line.
    [updated, sync, saving, count, refresh].forEach(element => cluster.insertBefore(element, user));
  } else {
    [refresh, updated, sync, saving, count].forEach(element => toolbar.appendChild(element));
  }
}

// Which anchor the NEXT schedule render should scroll to, or null to leave the
// scroll position alone. Set only by deliberate navigation (entering the view,
// the arrows, "Today") and cleared once used.
//
// This has to be opt-in per render because renderActiveView is subscribed to
// every state change. Previously the schedule scrolled to its anchor on any
// re-render at all, so a poll landing mid-read — or just ticking a checkbox —
// yanked the reader back up the page. That's the exact hazard the comment in
// switchView warns about; schedule view had been exempted from the guard in a
// way that reintroduced it.
let scheduleScrollTarget = null;

function applyScheduleScroll(container) {
  if (activeView !== 'schedule' || !scheduleScrollTarget) return;
  // Fall back to the other anchor when the preferred one isn't in the DOM —
  // "oldest open job" doesn't exist when everything is complete, and the
  // refDate group doesn't exist on a day with no jobs due.
  const preferred = scheduleScrollTarget === 'open' ? '[data-open-anchor="true"]' : '[data-date-anchor="true"]';
  const fallback = scheduleScrollTarget === 'open' ? '[data-date-anchor="true"]' : '[data-open-anchor="true"]';
  const anchor = container.querySelector(preferred) || container.querySelector(fallback);
  // Only consume the request once it's actually been honoured. If the view
  // rendered before the job list arrived there's nothing to anchor to yet, and
  // the scroll should happen on the render that finally has data.
  if (!anchor) return;
  anchor.scrollIntoView({ block: 'start' });
  scheduleScrollTarget = null;
}

function renderActiveView() {
  if (isTvDisplay()) {
    activeView = 'week';
    refDate = new Date();
    tvDayKey = localDayKey(refDate);
  }
  const view = VIEWS[activeView];
  const container = document.getElementById('view-area');
  view.render(container, refDate, getJobs());
  document.getElementById('current-range').textContent = view.label(refDate);
  document.querySelectorAll('.view-switcher button[data-view]').forEach(btn => {
    const isActive = btn.dataset.view === activeView;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  document.getElementById('view-btn-assign').classList.toggle('active', activeView === 'assign');
  document.getElementById('view-btn-other-production').classList.toggle('active', activeView === 'otherProduction');
  document.getElementById('view-btn-job-selector').classList.toggle('active', activeView === 'jobSelector');
  document.getElementById('view-btn-hours-log').classList.toggle('active', activeView === 'hoursLog');
  const isFocusedScreen = activeView === 'archive' || activeView === 'otherProduction' || activeView === 'jobSelector' || activeView === 'hoursLog';
  document.querySelector('.date-nav').hidden = isFocusedScreen;
  document.getElementById('stats-bar').hidden = isFocusedScreen;
  renderPendingWriteStatus();
  applyScheduleScroll(container);
}

function switchView(view) {
  if (isTvDisplay() && view !== 'week') return;
  const container = document.getElementById('view-area');
  container.classList.remove('view-enter');
  activeView = view;
  if (view === 'jobSelector') resetJobSelectorStatus();
  if (view === 'hoursLog') resetHoursLog();
  // Opening the schedule lands on the oldest still-open job rather than today.
  if (view === 'schedule') scheduleScrollTarget = 'open';
  renderActiveView();
  requestAnimationFrame(() => container.classList.add('view-enter'));
  // Data-refresh-triggered re-renders (subscribe(renderActiveView) below)
  // must never do this — only an actual tab switch should jump the
  // scroll position, or a mid-read poll update would yank someone back to
  // the top every 30 seconds. Schedule view positions itself via
  // scheduleScrollTarget above, so it's excluded here.
  if (activeView !== 'schedule') {
    document.getElementById('view-area').scrollTop = 0;
  }
}

// The tracking version this page last synced to — see fetchTrackingVersion()
// in api.js. Polling compares a fresh version read against this and only
// pulls the full job list (which re-hits CalendarApp + the tracking Sheet)
// when it's actually stale, so idle tabs cost one cheap Property read per
// poll tick instead of a full refetch.
let lastKnownVersion = 0;
let proofPreloadTimer = null;

function queueTwoWeekProofPreload(jobs) {
  if (proofPreloadTimer) clearTimeout(proofPreloadTimer);
  // Stagger browser sessions so the shop's iPads do not all hit Apps Script
  // at the same instant at the start of a shift.
  const delay = 1000 + Math.floor(Math.random() * 4000);
  proofPreloadTimer = setTimeout(() => {
    proofPreloadTimer = null;
    preloadCurrentAndNextWeekProofs(jobs).catch(() => {});
  }, delay);
}

/**
 * @param {boolean} [userInitiated] true when the Refresh button was pressed —
 *   an explicit action always deserves immediate feedback, whereas a background
 *   poll waits for repeated failures before saying anything (see syncStatus).
 */
function refreshJobs(userInitiated = false) {
  const refreshBtn = document.getElementById('refresh-btn');
  const viewArea = document.getElementById('view-area');
  refreshBtn.classList.add('spinning');
  refreshBtn.disabled = true;
  viewArea.setAttribute('aria-busy', 'true');
  return fetchProductionJobs()
    .then(({ jobs, version }) => {
      setJobs(jobs);
      saveCachedJobs(currentDepartment(), jobs);
      queueTwoWeekProofPreload(jobs);
      lastKnownVersion = version;
      const otherCount = jobs.filter(job => job.isOtherProduction && !job.dueDate && !job.completed).length;
      const scheduledCount = jobs.filter(job => !!job.dueDate).length;
      document.getElementById('header-count').textContent = otherCount
        ? `${scheduledCount} scheduled · ${otherCount} other`
        : `${scheduledCount} job${scheduledCount === 1 ? '' : 's'} shown`;
      document.getElementById('last-updated').textContent =
        `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      reportSyncSuccess();
      return true;
    })
    .catch(err => {
      // Was `.catch(() => {})`. A silent failure here left a stale list sitting
      // under a fresh-looking "Updated" timestamp with nothing to suggest it
      // wasn't current.
      console.error('Failed to refresh jobs:', err);
      if (userInitiated) showToast("Couldn't refresh — check your connection", 'error');
      reportSyncFailure();
      if (!getJobs().length) renderLoadFailure();
      return false;
    })
    .finally(() => {
      refreshBtn.classList.remove('spinning');
      refreshBtn.disabled = false;
      viewArea.setAttribute('aria-busy', 'false');
    });
}

function renderLoadFailure() {
  const viewArea = document.getElementById('view-area');
  viewArea.innerHTML = `
    <div class="empty-state" role="alert">
      <div class="empty-state-icon">!</div>
      <div class="empty-state-title">Could not load production jobs</div>
      <div class="empty-state-subtitle">Check the connection, then try again. Production can use the paper/Squarecoil fallback during an outage.</div>
      <button class="empty-state-retry settings-action primary" type="button">Retry</button>
    </div>`;
  viewArea.querySelector('.empty-state-retry').addEventListener('click', () => {
    viewArea.innerHTML = loadingJobsHtml();
    refreshJobs(true);
  });
}

function loadingJobsHtml() {
  return `<div class="loading-jobs" aria-label="Loading jobs">
    <div class="loading-jobs-title">Loading production schedule…</div>
    <div class="loading-jobs-grid" aria-hidden="true">
      ${Array.from({ length: 6 }, () => '<div class="skeleton-job-card"><span></span><div><i></i><i></i></div></div>').join('')}
    </div>
  </div>`;
}

// This app's backend runs on a consumer Google account, whose hard ceiling is
// 30 simultaneous Apps Script executions. At 30 users an aggressive poll makes
// that a real risk — not on average, but in bursts (everyone opening the app at
// shift start), and a burst past the ceiling surfaces as failed requests.
//
// Three things keep the aggregate down without the app feeling any less live:
//   • 30s base interval rather than 10s
//   • random jitter, so tabs that started together don't stay in lockstep and
//     re-converge into a thundering herd on every tick
//   • a longer interval once a tab has gone untouched for a while — a screen
//     left open on a shop-floor terminal shouldn't cost the same as one being
//     actively worked
// Responsiveness comes from the visibilitychange handler below (an immediate
// check whenever a tab is focused) and from optimistic local updates, not from
// the poll rate.
const POLL_INTERVAL_MS = 30000;
const POLL_JITTER_MS = 5000;
const POLL_IDLE_INTERVAL_MS = 180000;
const IDLE_AFTER_MS = 300000;

let pollTimer = null;
// Bumped by every start/stop. A tick that resolves after its generation is
// superseded doesn't reschedule — without this, calling startPolling() while a
// request is in flight (which visibilitychange does) leaves the old chain alive
// alongside the new one, doubling the poll rate every time a tab is refocused.
let pollGeneration = 0;
let lastInteractionAt = Date.now();

['pointerdown', 'keydown'].forEach(evt => {
  document.addEventListener(evt, () => { lastInteractionAt = Date.now(); }, { passive: true });
});

function nextPollDelay() {
  const idle = Date.now() - lastInteractionAt > IDLE_AFTER_MS;
  const base = idle ? POLL_IDLE_INTERVAL_MS : POLL_INTERVAL_MS;
  return base + Math.random() * POLL_JITTER_MS;
}

function checkForTrackingUpdate() {
  // Never replace the job collection under an open editor or an in-flight
  // local write. The cheap version check resumes on the next poll, preserving
  // near-real-time updates everywhere else without interrupting fast entry.
  if (isJobDetailOpen()) return Promise.resolve();
  if (hasPendingWrites()) return Promise.resolve();
  return fetchTrackingVersion()
    .then(version => {
      reportSyncSuccess();
      if (version !== lastKnownVersion) refreshJobs();
    })
    .catch(err => {
      console.error('Tracking version poll failed:', err);
      reportSyncFailure();
    });
}

// setTimeout rather than setInterval so each tick can pick a fresh jittered
// delay, and so a slow response can never stack overlapping requests.
function scheduleNextPoll(generation) {
  pollTimer = setTimeout(() => {
    if (generation !== pollGeneration) return;
    checkForTrackingUpdate().finally(() => {
      if (generation === pollGeneration) scheduleNextPoll(generation);
    });
  }, nextPollDelay());
}

function startPolling() {
  stopPolling();
  scheduleNextPoll(pollGeneration);
}
function stopPolling() {
  pollGeneration++;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
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
      const updateAvailable = !!(data.version && data.version !== bootVersion);
      document.getElementById('update-banner').classList.toggle('show', updateAvailable);
      // Settings is a full-screen overlay above the main app content, so
      // the banner above (part of that content) is hidden behind it —
      // this is the same banner, shown inside Settings too so "Update now"
      // is reachable without backing out first.
      document.getElementById('settings-update-banner').hidden = !updateAvailable;
      if (manual) {
        checkBtn.textContent = updateAvailable ? 'Update available — see banner above' : "You're up to date";
        if (!updateAvailable) setTimeout(() => { checkBtn.textContent = 'Check for updates'; }, 2500);
      }
    })
    .catch(() => {
      if (manual) {
        checkBtn.textContent = 'Could not check — try again';
        setTimeout(() => { checkBtn.textContent = 'Check for updates'; }, 2500);
      }
    });
}

function reloadForUpdate() {
  window.location.href = updateReloadUrl(window.location.href);
}

const ZOOM_STEPS = [50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
const ZOOM_KEY = 'sws_prod_cal_zoom';
const THEME_KEY = 'sws_prod_cal_theme';
const savedTheme = localStorage.getItem(THEME_KEY);

function applyTheme(theme) {
  const selectedTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', selectedTheme);
  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) themeSelect.value = selectedTheme;
  localStorage.setItem(THEME_KEY, selectedTheme);
}

applyTheme(savedTheme);
const savedZoomIdx = ZOOM_STEPS.indexOf(+localStorage.getItem(ZOOM_KEY));
let zoomIdx = savedZoomIdx !== -1 ? savedZoomIdx : ZOOM_STEPS.indexOf(100);

function applyZoom() {
  const pct = ZOOM_STEPS[zoomIdx];
  document.getElementById('view-area').style.zoom = pct / 100;
  document.getElementById('zoom-label').textContent = `${pct}%`;
  localStorage.setItem(ZOOM_KEY, pct);
}

function openSettings(forcePinChange = false) {
  const required = mustChangePin() || forcePinChange === true;
  document.getElementById('settings-backdrop').classList.add('show');
  document.getElementById('settings-panel').classList.add('show');
  document.getElementById('pin-change-required').hidden = !required;
  document.getElementById('settings-close-btn').hidden = required;
  document.getElementById('settings-panel').classList.toggle('pin-change-required', required);
  setHeaderDimmed(true);
  const nameField = document.getElementById('my-account-name');
  nameField.value = currentUser() || '';
  nameField.readOnly = !isAdmin();
  nameField.title = isAdmin() ? 'Admins can update account names' : 'Only an Admin can change account names';
  document.getElementById('my-account-hint').textContent = '';
  const defaultView = document.getElementById('default-view-select');
  defaultView.value = getDefaultView();
  Array.from(defaultView.options).forEach(option => { option.hidden = !canOpenView(option.value); });
  document.getElementById('theme-select').value = document.documentElement.dataset.theme || 'light';

  // Fetched fresh each time rather than kept in the session, so the PIN lives
  // only in this input while the panel is open — it's never written to
  // localStorage the way it used to be.
  const pinField = document.getElementById('my-account-pin');
  pinField.value = '';
  pinField.placeholder = 'New 6-digit PIN';

  refreshSquarecoilSettingsUI();
  refreshSystemHealthUI();
  if (required) setTimeout(() => pinField.focus(), 0);
}
function closeSettings() {
  if (mustChangePin()) {
    document.getElementById('my-account-hint').textContent = 'Set a new PIN before returning to the calendar.';
    return;
  }
  document.getElementById('settings-backdrop').classList.remove('show');
  document.getElementById('settings-panel').classList.remove('show');
  setHeaderDimmed(false);
  // Don't leave the PIN sitting in the DOM once the panel is closed.
  document.getElementById('my-account-pin').value = '';
}

function saveMyAccount() {
  const hint = document.getElementById('my-account-hint');
  const saveButton = document.getElementById('my-account-save-btn');
  const name = document.getElementById('my-account-name').value.trim();
  const pin = document.getElementById('my-account-pin').value.trim();
  if (isAdmin() && !name) { hint.textContent = 'Name is required'; return; }
  // A blank PIN means "leave mine alone"; current credentials are never
  // prefilled or stored in the browser.
  if (pin && !/^\d{6}$/.test(pin)) { hint.textContent = 'PIN must be 6 digits'; return; }
  if (!pin && !isAdmin()) { hint.textContent = 'Enter a new 6-digit PIN'; return; }
  hint.textContent = 'Saving…';
  saveButton.disabled = true;
  const patch = { ...(isAdmin() ? { name } : {}), ...(pin ? { pin } : {}) };
  return updateSelf(patch)
    .then(res => {
      if (!res.success) { hint.textContent = res.error || 'Failed to save'; return; }
      // Reflect what was actually stored, so a rejected PIN doesn't linger in
      // the field looking accepted.
      document.getElementById('my-account-pin').value = '';
      updateAuthProfile({ user: res.user.name, mustChangePin: false, ...(res.token ? { token: res.token } : {}) });
      document.getElementById('user-badge').textContent = res.user.name;
      hint.textContent = pin ? 'PIN updated' : 'Saved';
      showToast(pin ? 'Your PIN was updated' : 'Account details saved');
      document.getElementById('pin-change-required').hidden = true;
      document.getElementById('settings-close-btn').hidden = false;
      document.getElementById('settings-panel').classList.remove('pin-change-required');
      setTimeout(() => { hint.textContent = ''; }, 1500);
    })
    .catch(() => { hint.textContent = 'Network error — try again'; })
    .finally(() => { saveButton.disabled = false; });
}

function boot() {
  activeView = getDefaultView();
  if (isTvDisplay()) activeView = 'week';
  configureHeaderForRole();
  // Warm the PDF engine in parallel with the first jobs request. This does
  // not block app startup, but removes a cold CDN/module load from the first
  // Production File the user opens.
  preloadPdfViewer().catch(() => {});
  document.getElementById('user-badge').textContent = currentUser() || '';
  const deptBadge = document.getElementById('dept-badge');
  const department = currentDepartment();
  deptBadge.textContent = department || '';
  deptBadge.hidden = !department || department === 'Viewer' || department === 'Costing Viewer' || department === 'TV';
  document.getElementById('settings-usermgmt-btn').hidden = !canManageUsers();
  document.getElementById('settings-common-tasks-btn').hidden = !canAssignDepartments();
  document.getElementById('settings-costing-buttons-btn').hidden = !canManageCostingButtons();
  document.getElementById('settings-production-statuses-btn').hidden = !canManageProductionStatuses();
  document.getElementById('settings-management-card').hidden = !(canManageUsers() || canAssignDepartments() || canManageCostingButtons() || canManageProductionStatuses());
  document.getElementById('view-btn-assign').hidden = !canAssignDepartments();
  document.getElementById('view-btn-other-production').hidden = !canViewOtherProduction();
  document.getElementById('view-btn-job-selector').hidden = !canUseJobSelector();
  document.getElementById('view-btn-hours-log').hidden = !canViewHoursLog();
  applyZoom();

  document.querySelectorAll('.view-switcher button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.getElementById('view-btn-assign').addEventListener('click', () => switchView('assign'));
  document.getElementById('view-btn-other-production').addEventListener('click', () => switchView('otherProduction'));
  document.getElementById('view-btn-job-selector').addEventListener('click', () => switchView('jobSelector'));
  document.getElementById('view-btn-hours-log').addEventListener('click', () => switchView('hoursLog'));
  // The arrows step by date in every view, schedule included — that's what
  // makes them meaningful there, since the schedule renders every job at once
  // and only the scroll position distinguishes one "page" from the next.
  document.getElementById('nav-prev').addEventListener('click', () => {
    refDate = VIEWS[activeView].step(refDate, -1);
    scheduleScrollTarget = 'date';
    renderActiveView();
  });
  document.getElementById('nav-next').addEventListener('click', () => {
    refDate = VIEWS[activeView].step(refDate, 1);
    scheduleScrollTarget = 'date';
    renderActiveView();
  });
  // "Today" is the get-me-back-to-where-I-should-be button, so in the schedule
  // it returns to the oldest open job rather than the literal current date.
  document.getElementById('nav-today').addEventListener('click', () => {
    refDate = new Date();
    scheduleScrollTarget = 'open';
    renderActiveView();
  });
  document.getElementById('refresh-btn').addEventListener('click', () => refreshJobs(true));
  document.getElementById('job-detail-close').addEventListener('click', closeJobDetail);
  document.getElementById('job-detail-save-close').addEventListener('click', closeJobDetail);
  document.getElementById('job-detail-overlay').addEventListener('click', e => {
    if (e.target.id === 'job-detail-overlay') closeJobDetail();
  });
  document.getElementById('proof-viewer-close').addEventListener('click', closeProofViewer);

  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close-btn').addEventListener('click', closeSettings);
  document.getElementById('settings-backdrop').addEventListener('click', closeSettings);
  document.getElementById('settings-signout-btn').addEventListener('click', () => { closeSettings(); signOut(); });
  document.getElementById('settings-check-btn').addEventListener('click', () => checkForUpdate(true));
  document.getElementById('default-view-select').addEventListener('change', event => {
    saveDefaultView(event.target.value);
    showToast(`Default view set to ${event.target.selectedOptions[0].textContent}`);
  });
  document.getElementById('theme-select').addEventListener('change', event => {
    applyTheme(event.target.value);
    showToast(`${event.target.selectedOptions[0].textContent} theme enabled`);
  });
  document.getElementById('settings-usermgmt-btn').addEventListener('click', () => { closeSettings(); openUserManagement(); });
  document.getElementById('settings-common-tasks-btn').addEventListener('click', () => { closeSettings(); openCommonTaskManagement(); });
  document.getElementById('settings-costing-buttons-btn').addEventListener('click', () => { closeSettings(); openCostingButtonManagement(); });
  document.getElementById('settings-production-statuses-btn').addEventListener('click', () => { closeSettings(); openProductionStatusManagement(); });
  window.addEventListener('open-settings', openSettings);
  document.getElementById('my-account-save-btn').addEventListener('click', saveMyAccount);
  document.getElementById('my-account-pin').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveMyAccount();
  });
  initUserManagement();
  initCommonTaskManagement();
  initCostingButtonManagement();
  initProductionStatusManagement();
  initSquarecoilSettings();
  initSystemHealth();
  if (canAssignDepartments()) refreshCommonTasks().catch(() => {});
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
  document.getElementById('view-area').innerHTML = loadingJobsHtml();
  document.getElementById('view-area').setAttribute('aria-busy', 'true');

  subscribe(renderActiveView);
  subscribe(renderStatsBar);

  // Fires once per outage, not once per failed poll.
  setOnFirstFailure(() => showToast('Not syncing — showing the last data received', 'error'));

  // Paint last-known jobs instantly from a local cache while the real
  // fetch is still in flight (it re-hits CalendarApp + the tracking Sheet,
  // which can take a few seconds) — refreshJobs() below reconciles with
  // fresh data as soon as it lands, same as a normal poll-triggered update.
  const cachedJobs = loadCachedJobs(currentDepartment());
  if (cachedJobs) setJobs(cachedJobs);

  refreshJobs().then(() => { if (document.visibilityState === 'visible') startPolling(); });
  checkForUpdate();
  if (mustChangePin()) openSettings(true);
}

document.getElementById('update-reload-btn').addEventListener('click', reloadForUpdate);
document.getElementById('settings-update-reload-btn').addEventListener('click', reloadForUpdate);

function updateOnlineState() {
  document.getElementById('offline-banner').hidden = navigator.onLine;
}
window.addEventListener('offline', updateOnlineState);
window.addEventListener('online', () => {
  updateOnlineState();
  refreshJobs(true);
});
document.getElementById('offline-retry-btn').addEventListener('click', () => refreshJobs(true));
updateOnlineState();

// A home-screen PWA left open in the background is often resumed from a
// suspended in-memory instance rather than a real reload, so it never
// re-runs boot()'s one-time version check. Re-check whenever it regains
// focus/visibility so the update banner reliably shows up.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (isTvDisplay() && localDayKey() !== tvDayKey) renderActiveView();
    checkForUpdate();
    checkForTrackingUpdate();
    startPolling();
  } else {
    stopPolling();
  }
});

// A production TV can remain open across Sunday/week boundaries. Keep its
// date anchored to the real current week without requiring a reload.
setInterval(() => {
  if (isTvDisplay() && localDayKey() !== tvDayKey) renderActiveView();
}, 60000);

// The shop TV runs unattended for weeks at a time. An hourly reload picks up
// deploys and clears any drift a session that long can accumulate.
const TV_RELOAD_INTERVAL_MS = 60 * 60 * 1000;
setInterval(() => {
  if (isTvDisplay()) window.location.reload();
}, TV_RELOAD_INTERVAL_MS);

// See sw.js — forces every fetch to the network so a deploy is never left
// partially stale by the browser/CDN cache.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

initAuth(boot);
