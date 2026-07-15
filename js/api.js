import { SCRIPT_URL } from './config.js';
import { getAuth, signOut } from './auth.js';

/** @param {string} action @returns {Promise<any>} */
function scriptGet(action, extraParams = {}) {
  const auth = getAuth();
  const params = new URLSearchParams({ action, token: auth ? auth.token : '', ...extraParams });
  return fetch(`${SCRIPT_URL}?${params.toString()}`)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(checkAuthError);
}

/** @param {Record<string, unknown>} body @returns {Promise<any>} */
export function scriptPost(body) {
  const auth = getAuth();
  const payload = body.action === 'login' ? body : { ...body, token: auth ? auth.token : '' };
  return fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(checkAuthError);
}

function checkAuthError(data) {
  if (data && data.error === 'unauthorized') {
    signOut();
    throw new Error('unauthorized');
  }
  return data;
}

export const fetchProductionJobs = () => scriptGet('getProductionJobs').then(d => d.jobs || []);

export const toggleComplete = (jobKey, completed) =>
  scriptPost({ action: 'toggleComplete', jobKey, completed });

export const updateNotes = (jobKey, notes) =>
  scriptPost({ action: 'updateNotes', jobKey, notes });

/** @param {string} dueDate "YYYY-MM-DD", or '' to clear the override and revert to the calculated date */
export const updateDueDate = (jobKey, dueDate) =>
  scriptPost({ action: 'updateDueDate', jobKey, dueDate });

export const fetchUsers = () => scriptGet('getUsers').then(d => d.users || []);

export const addUser = (name, department, pin) =>
  scriptPost({ action: 'addUser', name, department, pin });

/** @param {string} id @param {{name?: string, department?: string, pin?: string}} patch */
export const updateUser = (id, patch) =>
  scriptPost({ action: 'updateUser', id, ...patch });

export const deleteUser = id =>
  scriptPost({ action: 'deleteUser', id });

/** @param {{name?: string, pin?: string}} patch — updates the signed-in user's own name/PIN */
export const updateSelf = patch =>
  scriptPost({ action: 'updateSelf', ...patch });

/** @param {string} jobKey @param {string[]} departments @param {Record<string, {id: string, text: string, done: boolean}[]>} departmentChecklists */
export const updateJobDepartments = (jobKey, departments, departmentChecklists) =>
  scriptPost({ action: 'updateJobDepartments', jobKey, departments, departmentChecklists });

/** @param {string} jobKey @param {string} department @param {string} itemId @param {boolean} done */
export const toggleDepartmentTaskDone = (jobKey, department, itemId, done) =>
  scriptPost({ action: 'toggleDepartmentTaskDone', jobKey, department, itemId, done });
