// A stable per-browser id, sent with login attempts so the server can throttle
// failed PIN entries per device instead of globally (see checkPin in Code.js).
// Before this, one person mistyping their PIN locked out the whole company.
//
// This is not a security token and is never treated as one — it's forgeable by
// anyone, it grants nothing, and the server keeps a separate global circuit
// breaker precisely because an attacker can rotate it. It exists so one
// device's mistakes stay that device's problem.
const DEVICE_ID_KEY = 'sws_prod_cal_device_id';

function generateId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** @returns {string} stable id for this browser, created on first use */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = generateId();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch (err) {
    // Private mode or storage disabled — a fresh id per attempt just means this
    // browser falls back to being throttled with everyone else, which is the
    // old behavior rather than a regression.
    return generateId();
  }
}
