import { preservePendingNotesInJobs } from './optimisticNotes.mjs';

let jobs = [];
const archivedJobs = new Map();
const subscribers = [];

export const getJobs = () => jobs;

export function setJobs(nextJobs) {
  jobs = preservePendingNotesInJobs(jobs, nextJobs);
  subscribers.forEach(fn => fn(jobs));
}

/** Shallow-merges a patch into one job by jobKey and notifies subscribers. */
export function patchJob(jobKey, patch) {
  jobs = jobs.map(j => (j.jobKey === jobKey ? { ...j, ...patch } : j));
  if (archivedJobs.has(jobKey)) archivedJobs.set(jobKey, { ...archivedJobs.get(jobKey), ...patch });
  subscribers.forEach(fn => fn(jobs));
}

export function registerArchivedJob(job) {
  if (job && job.jobKey) archivedJobs.set(job.jobKey, job);
}

export function findJob(jobKey) {
  return jobs.find(j => j.jobKey === jobKey) || archivedJobs.get(jobKey) || null;
}

/** @param {(jobs: object[]) => void} fn */
export function subscribe(fn) {
  subscribers.push(fn);
  return () => {
    const i = subscribers.indexOf(fn);
    if (i !== -1) subscribers.splice(i, 1);
  };
}
