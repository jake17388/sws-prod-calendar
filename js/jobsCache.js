// Lets boot() paint the last-known job list immediately (before the network
// round-trip resolves) instead of a blank screen, then let the real fetch
// silently reconcile it. Keyed by department, not by user/token — the
// backend already filters production-department accounts to their own
// current jobs, so two people in the same department would see the same
// list anyway, but keying by department (rather than a fixed key) stops a
// department switch on a shared device from briefly flashing a
// differently-permissioned cached view.
const CACHE_PREFIX = 'sws_prod_cal_jobs_cache_v1:';
// Bounds how old a cached list can be before it's not even worth painting
// briefly — a week-stale list is more confusing than a loading state.
const MAX_AGE_MS = 24 * 3600 * 1000;

/** @param {string} department @returns {object[]|null} */
export function loadCachedJobs(department) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + (department || 'none'));
    if (!raw) return null;
    const { jobs, savedAt } = JSON.parse(raw);
    if (!Array.isArray(jobs) || !savedAt || Date.now() - savedAt > MAX_AGE_MS) return null;
    return jobs;
  } catch (err) {
    return null;
  }
}

/** @param {string} department @param {object[]} jobs */
export function saveCachedJobs(department, jobs) {
  try {
    localStorage.setItem(CACHE_PREFIX + (department || 'none'), JSON.stringify({ jobs, savedAt: Date.now() }));
  } catch (err) {
    // localStorage full/unavailable — fine, this cache is a load-time
    // nicety, not required for correctness.
  }
}

/** Clears every cached job list (all departments) — called on sign-out so a shared device never briefly shows a previous account's data before the network round-trip lands. */
export function clearCachedJobs() {
  Object.keys(localStorage)
    .filter(k => k.startsWith(CACHE_PREFIX))
    .forEach(k => localStorage.removeItem(k));
}
