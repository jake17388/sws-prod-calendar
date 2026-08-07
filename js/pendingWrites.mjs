let pendingCount = 0;
const listeners = new Set();

function notify() {
  const pending = pendingCount > 0;
  listeners.forEach(listener => listener(pending, pendingCount));
}

export function beginWrite() {
  pendingCount += 1;
  notify();
}

export function endWrite() {
  pendingCount = Math.max(0, pendingCount - 1);
  notify();
}

export const hasPendingWrites = () => pendingCount > 0;

export function subscribePendingWrites(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
