export function selectableJobSelectorJobs(jobs, department) {
  return (Array.isArray(jobs) ? jobs : [])
    .filter(job => {
      if (!job || job.completed) return false;
      if (!(job.departments || []).includes(department)) return false;
      return ((job.departmentChecklists && job.departmentChecklists[department]) || [])
        .some(task => !task.done);
    })
    .map(job => ({
      ...job,
      openTaskCount: ((job.departmentChecklists && job.departmentChecklists[department]) || [])
        .filter(task => !task.done).length,
    }))
    .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || ''))
      || String(a.jobNum || '').localeCompare(String(b.jobNum || '')));
}
