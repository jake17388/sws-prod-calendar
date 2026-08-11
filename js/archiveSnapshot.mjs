export function archiveSnapshotFor(job) {
  return {
    jobNum: job.jobNum,
    title: job.title,
    addr: job.addr,
    crew: job.crew,
    startDate: job.startDate,
    endDate: job.endDate,
    dueDate: job.autoDueDate || job.dueDate,
  };
}
