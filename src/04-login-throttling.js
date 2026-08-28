// ── Login throttling ────────────────────────────────────────────────────────
// This replaces a single script-wide `pin_fails` counter, which had three
// problems: one person mistyping their PIN ten times locked out the entire
// company; the /exec endpoint is ANYONE_ANONYMOUS, so anyone on the internet
// could trigger that lockout deliberately; and because CacheService.put resets
// an entry's TTL, every further attempt pushed the unlock time back, so a
// script hammering the endpoint kept everyone locked out indefinitely.
//
// Now failures are counted per device, and the lockout is stored as an ABSOLUTE
// expiry timestamp — re-writing the entry can no longer extend an active
// lockout. A much higher global counter is kept as a last-resort circuit
// breaker, since Apps Script never exposes the client IP and a determined
// attacker can just rotate device ids.
//
// PINs are hashed and newly-issued credentials use six digits. Device and
// global limits remain necessary because the PIN itself identifies the account,
// so Apps Script cannot apply an account-specific failure counter until a
// correct PIN has identified that account.
const PIN_FAILS_PER_DEVICE = 8;
const DEVICE_LOCKOUT_MS = 10 * 60 * 1000;
const GLOBAL_FAILS_LIMIT = 60;          // across all devices, per window
const GLOBAL_WINDOW_SECONDS = 600;
const GLOBAL_COOLDOWN_MS = 5 * 60 * 1000;
const THROTTLE_CACHE_SECONDS = 3600;

function readThrottle(cache, key) {
  const raw = cache.get(key);
  if (!raw) return { n: 0, until: 0 };
  try {
    const parsed = JSON.parse(raw);
    return { n: +parsed.n || 0, until: +parsed.until || 0 };
  } catch (err) {
    return { n: 0, until: 0 };
  }
}

function writeThrottle(cache, key, state) {
  cache.put(key, JSON.stringify(state), THROTTLE_CACHE_SECONDS);
}

// Device ids come from the client and are trivially forgeable — they exist to
// keep one person's typos from affecting anyone else, not as a security
// boundary. Anything unusable falls back to a shared bucket rather than being
// rejected, so a client that can't supply one still gets throttled.
function deviceKey(deviceId) {
  const clean = String(deviceId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return 'pin_fails_dev_' + (clean || 'unknown');
}

function checkPin(pin, deviceId) {
  const cache = CacheService.getScriptCache();
  const now = Date.now();
  const devKey = deviceKey(deviceId);

  const device = readThrottle(cache, devKey);
  if (device.until && now < device.until) {
    return { ok: false, locked: true, retryInSeconds: Math.ceil((device.until - now) / 1000) };
  }

  const global = readThrottle(cache, 'pin_fails_global');
  if (global.until && now < global.until) {
    return { ok: false, locked: true, retryInSeconds: Math.ceil((global.until - now) / 1000) };
  }

  const candidate = String(pin || '');
  const user = /^\d{6}$/.test(candidate) ? authenticatePin(candidate) : null;
  if (!user) {
    const nextDeviceCount = device.n + 1;
    writeThrottle(cache, devKey, nextDeviceCount >= PIN_FAILS_PER_DEVICE
      ? { n: 0, until: now + DEVICE_LOCKOUT_MS }
      : { n: nextDeviceCount, until: 0 });

    // The global counter's own window is the cache TTL — it isn't refreshed on
    // every write the way the old counter's was, so a burst has to actually
    // reach the limit inside one window to trip the breaker.
    const nextGlobalCount = global.n + 1;
    if (nextGlobalCount >= GLOBAL_FAILS_LIMIT) {
      cache.put('pin_fails_global', JSON.stringify({ n: 0, until: now + GLOBAL_COOLDOWN_MS }), THROTTLE_CACHE_SECONDS);
      console.warn('Global PIN failure limit reached — logins paused for %s minutes', GLOBAL_COOLDOWN_MS / 60000);
    } else {
      cache.put('pin_fails_global', JSON.stringify({ n: nextGlobalCount, until: 0 }), GLOBAL_WINDOW_SECONDS);
    }
    return { ok: false };
  }

  // Clear this device's failures on success — the old counter never reset, so
  // nine mistypes followed by a correct PIN left everyone one attempt from a
  // lockout for the next ten minutes.
  cache.remove(devKey);
  return {
    ok: true,
    user: user.name,
    department: user.department,
    userId: user.id,
    token: makeToken(user),
    // Deprecated: the client now derives this from `department` (see
    // canEditDueDates in auth.js). Still sent so a browser running JS cached
    // from before that change doesn't lose the due-date button during the
    // window where Pages and Apps Script are deployed a few seconds apart.
    // Safe to delete once every client has reloaded.
    isDueDateEditor: canEditDueDates(user.department),
    canManageUsers: canAccessUserManagement(user.department),
    canViewHoursLog: canViewJobTimeLog(user),
    canEditHoursLog: canEditJobTimeLog(user),
    mustChangePin: !!user.mustChangePin,
  };
}

function authenticatePin(pin) {
  return getUsers().find(candidate => pinMatches(candidate, pin)) || null;
}

// Strips the PIN off a user record before it ever leaves the server. PINs are
// credentials: they were previously returned by getUsers (and echoed back by
// addUser/updateUser/updateSelf) and rendered into visible inputs in User
// Management, so any Manager could read every account's PIN off the screen.
// Nothing in the client needs a PIN value — it only ever writes new ones.
function publicUser(user) {
  if (!user) return user;
  const { pin, adminPin, pinHash, pinSalt, previousAuthVersion, previousAuthExpiresAt, ...rest } = user;
  return rest;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

const UNAUTHORIZED = { error: 'unauthorized' };

function validJobKey(value) {
  return /^\d{5,6}$/.test(String(value || ''));
}

function validDateOverride(value) {
  const text = String(value || '');
  if (!text) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(text + 'T12:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function sanitizeSheetText(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function validText(value, maxLength) {
  const text = String(value == null ? '' : value).trim();
  return !!text && text.length <= maxLength && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
}

function runMutationOnce(actor, data, operation) {
  const requestId = String((data && data.requestId) || '');
  // Compatibility for a browser tab that loaded immediately before this
  // deployment. Current clients always send a request id.
  if (!requestId) return operation();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) return { success: false, error: 'Invalid request id' };
  const key = ['mutation', actor.id, String(data.action || ''), requestId].join('_');
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (err) { /* recompute below */ }
  }
  const result = operation();
  try {
    const encoded = JSON.stringify(result);
    if (encoded.length < 90000) cache.put(key, encoded, 600);
  } catch (err) {
    console.warn('Could not cache mutation response for %s: %s', data.action, err && err.message);
  }
  return result;
}

// A single incrementing counter, bumped on every successful tracking write
// (see setTracking()). Lets clients poll a one-Property read to know
// whether anything changed, instead of re-fetching the full job list (which
// re-hits CalendarApp + the tracking Sheet) on every poll tick.
function getTrackingVersion() {
  const v = PropertiesService.getScriptProperties().getProperty('TRACKING_VERSION');
  return v ? +v : 0;
}
function bumpTrackingVersion() {
  const props = PropertiesService.getScriptProperties();
  const next = (+(props.getProperty('TRACKING_VERSION') || 0)) + 1;
  props.setProperty('TRACKING_VERSION', String(next));
  return next;
}
