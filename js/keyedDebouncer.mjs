export function createKeyedDebouncer(delay = 220, options = {}) {
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const timers = new Map();

  return {
    schedule(key, callback, wait = delay) {
      if (timers.has(key)) clearTimer(timers.get(key));
      const timer = setTimer(() => {
        timers.delete(key);
        callback();
      }, wait);
      timers.set(key, timer);
    },
    cancel(key) {
      if (!timers.has(key)) return;
      clearTimer(timers.get(key));
      timers.delete(key);
    },
    pending(key) {
      return timers.has(key);
    },
  };
}
