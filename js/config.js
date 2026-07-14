// Apps Script deployment URL — update this after each `clasp deploy`.
export const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz8bqqB_Okjx6efXTCT7nRE0LMnQkb6-QinZ8S5AVz0hA1vZP_rxdoIMpjmwIdJlm7C7w/exec';

export const AUTH_KEY = 'sws_prod_cal_auth_v2';

export const DUE_SOON_DAYS = 2;

// Mirrors Code.js's DEPARTMENTS/PM_BLOCKED_EDIT_DEPARTMENTS — the server is
// the source of truth for what's actually allowed; these only drive which
// options the User Management screen offers so a Manager never even sees a
// choice the backend would reject.
export const DEPARTMENTS = ['Admin', 'Manager', 'Viewer', 'Manufacturing', 'Graphics', 'Paint', 'Assembly', 'Letters', 'Routing'];
export const PM_BLOCKED_DEPARTMENTS = ['Admin', 'Manager', 'Viewer'];

// Mirrors Code.js's JOB_DEPARTMENTS/JOB_TAGS — job-assignable tags, distinct
// from the user DEPARTMENTS list above. Ship-In isn't a role anyone logs in
// as; it's a job-only tag meaning "made elsewhere, just shipped in to us".
export const JOB_DEPARTMENTS = ['Manufacturing', 'Graphics', 'Paint', 'Assembly', 'Letters', 'Routing'];
export const JOB_TAGS = [...JOB_DEPARTMENTS, 'Ship-In'];
