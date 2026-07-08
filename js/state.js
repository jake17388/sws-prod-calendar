let jobs = [];
const subscribers = [];

export const getJobs = () => jobs;

export function setJobs(nextJobs) {
  jobs = nextJobs;
  subscribers.forEach(fn => fn(jobs));
}

/** Shallow-merges a patch into one job by jobKey and notifies subscribers. */
export function patchJob(jobKey, patch) {
  jobs = jobs.map(j => (j.jobKey === jobKey ? { ...j, ...patch } : j));
  subscribers.forEach(fn => fn(jobs));
}

export function findJob(jobKey) {
  return jobs.find(j => j.jobKey === jobKey) || null;
}

/** @param {(jobs: object[]) => void} fn */
export function subscribe(fn) {
  subscribers.push(fn);
  return () => {
    const i = subscribers.indexOf(fn);
    if (i !== -1) subscribers.splice(i, 1);
  };
}
