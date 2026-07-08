/** @param {number|null} pct 0-100, or null when the job has no checklist @returns {string} */
export function progressBarHtml(pct) {
  if (pct === null || pct === undefined) return '';
  return `
    <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    <div class="progress-label">${pct}% complete</div>
  `;
}
