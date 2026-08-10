/**
 * Split schedule jobs so completed work can be kept available without taking
 * space in the active schedule. The source order is preserved in both groups.
 * @param {object[]} jobs
 */
export function partitionScheduleJobs(jobs) {
  const open = [];
  const completed = [];

  jobs.forEach(job => {
    (job.completed ? completed : open).push(job);
  });

  return { open, completed };
}
