// Makes a failing sync visible. Every network path in this app used to end in
// `.catch(() => {})`, so when the backend was down or a quota was exhausted the
// UI showed a stale job list next to a confident "Updated 10:42 AM" and no
// indication anything was wrong. On a production floor that's worse than an
// error: someone works an hour-old list believing it's current.
//
// One failed poll is not worth shouting about — transient failures are normal
// on shop-floor wifi and the next tick usually recovers. The indicator appears
// once failures repeat, and a toast fires only on the transition into the
// failed state so a long outage doesn't produce a stream of them.
const FAILURES_BEFORE_WARNING = 2;

let consecutiveFailures = 0;
let showingFailure = false;
let lastSuccessAt = null;
let onFirstFailure = null;

/** @param {() => void} handler called once when sync transitions into the failed state */
export function setOnFirstFailure(handler) {
  onFirstFailure = handler;
}

function el() {
  return document.getElementById('sync-status');
}

function render() {
  const node = el();
  if (!node) return;

  if (!showingFailure) {
    node.hidden = true;
    node.textContent = '';
    node.removeAttribute('title');
    return;
  }

  node.hidden = false;
  node.textContent = '⚠ Not syncing';
  node.title = lastSuccessAt
    ? `Last successful update ${lastSuccessAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Showing data from then — it may be out of date.`
    : 'Could not reach the server. The list below may be out of date.';
}

export function reportSyncSuccess() {
  consecutiveFailures = 0;
  lastSuccessAt = new Date();
  if (showingFailure) {
    showingFailure = false;
    render();
  }
}

export function reportSyncFailure() {
  consecutiveFailures += 1;
  if (consecutiveFailures < FAILURES_BEFORE_WARNING || showingFailure) return;
  showingFailure = true;
  render();
  if (onFirstFailure) onFirstFailure();
}

/** @returns {boolean} whether sync is currently considered broken */
export const isSyncFailing = () => showingFailure;
