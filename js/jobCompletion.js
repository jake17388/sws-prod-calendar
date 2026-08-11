import { toggleComplete } from './api.js';
import { archiveSnapshotFor } from './archiveSnapshot.mjs';
import { createKeyedDebouncer } from './keyedDebouncer.mjs';
import { patchJob } from './state.js';
import { showToast } from './toast.js';

const debouncer = createKeyedDebouncer(220);
const pending = new Map();

function applyState(jobKey, state, isPending) {
  patchJob(jobKey, {
    completed: !!state.completed,
    completedAt: state.completedAt || '',
    completedBy: state.completedBy || '',
    completionPending: isPending,
  });
}

function settle(jobKey, entry, state, failed = false) {
  debouncer.cancel(jobKey);
  pending.delete(jobKey);
  applyState(jobKey, state, false);
  if (entry.handlers.onSettled) entry.handlers.onSettled(state, failed);
  if (failed) showToast('Failed to update job — check your connection', 'error');
}

function flush(jobKey) {
  const entry = pending.get(jobKey);
  if (!entry || entry.inFlight) return;
  if (entry.desired === entry.confirmed.completed) {
    settle(jobKey, entry, entry.confirmed);
    return;
  }

  const sent = entry.desired;
  entry.inFlight = true;
  toggleComplete(jobKey, sent, entry.snapshot)
    .then(result => {
      if (!result.success) throw new Error(result.error || 'failed');
      entry.confirmed = {
        completed: !!result.completed,
        completedAt: result.completedAt || '',
        completedBy: result.completedBy || '',
      };
      entry.inFlight = false;
      if (entry.desired !== sent) {
        applyState(jobKey, { ...entry.confirmed, completed: entry.desired }, true);
        debouncer.schedule(jobKey, () => flush(jobKey), 0);
        return;
      }
      settle(jobKey, entry, entry.confirmed);
    })
    .catch(() => {
      entry.inFlight = false;
      if (entry.desired !== sent) {
        debouncer.schedule(jobKey, () => flush(jobKey), 0);
        return;
      }
      settle(jobKey, entry, entry.confirmed, true);
    });
}

export function queueJobCompletion(job, completed, handlers = {}) {
  const jobKey = job.jobKey;
  let entry = pending.get(jobKey);
  if (!entry) {
    entry = {
      confirmed: {
        completed: !!job.completed,
        completedAt: job.completedAt || '',
        completedBy: job.completedBy || '',
      },
      desired: !!job.completed,
      inFlight: false,
      snapshot: archiveSnapshotFor(job),
      handlers: {},
    };
    pending.set(jobKey, entry);
  }
  entry.desired = !!completed;
  entry.snapshot = archiveSnapshotFor(job);
  entry.handlers = handlers;
  applyState(jobKey, { ...entry.confirmed, completed: entry.desired }, true);
  if (handlers.onOptimistic) handlers.onOptimistic(entry.desired);

  if (!entry.inFlight && entry.desired === entry.confirmed.completed) {
    settle(jobKey, entry, entry.confirmed);
    return;
  }
  debouncer.schedule(jobKey, () => flush(jobKey));
}
