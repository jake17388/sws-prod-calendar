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

export const fetchProductionJobs = () =>
  scriptGet('getProductionJobs').then(d => ({ jobs: d.jobs || [], version: d.version || 0 }));

/** Cheap poll target — one Script Property read, no Calendar/Sheet access. */
export const fetchTrackingVersion = () => scriptGet('getTrackingVersion').then(d => d.version || 0);

export const toggleComplete = (jobKey, completed) =>
  scriptPost({ action: 'toggleComplete', jobKey, completed });

/** @param {string} expectedUpdatedAt — the job's updatedAt as last read; server rejects with a 'conflict' if it's since moved */
export const updateNotes = (jobKey, notes, expectedUpdatedAt) =>
  scriptPost({ action: 'updateNotes', jobKey, notes, expectedUpdatedAt });

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

/** @param {string} jobKey @param {string[]} departments @param {Record<string, {id: string, text: string, done: boolean}[]>} departmentChecklists @param {string[]} currentDepartments @param {string} expectedUpdatedAt — the job's updatedAt as last read; server rejects with a 'conflict' if it's since moved */
export const updateJobDepartments = (jobKey, departments, departmentChecklists, currentDepartments, expectedUpdatedAt) =>
  scriptPost({ action: 'updateJobDepartments', jobKey, departments, departmentChecklists, currentDepartments, expectedUpdatedAt });

/** @param {string} jobKey @param {string} department @param {string} itemId @param {boolean} done */
export const toggleDepartmentTaskDone = (jobKey, department, itemId, done) =>
  scriptPost({ action: 'toggleDepartmentTaskDone', jobKey, department, itemId, done });

/** @param {string} jobKey @param {string} department @param {string} notes @param {string} expectedUpdatedAt — the job's updatedAt as last read; server rejects with a 'conflict' if it's since moved */
export const updateDepartmentNotes = (jobKey, department, notes, expectedUpdatedAt) =>
  scriptPost({ action: 'updateDepartmentNotes', jobKey, department, notes, expectedUpdatedAt });

/** @param {string} jobNum @returns {Promise<{available: boolean, name?: string, base64?: string}>} */
export const fetchProofFile = jobNum => scriptGet('getProofFile', { jobNum });

export const fetchDropboxStatus = () => scriptGet('getDropboxStatus');

/** @returns {Promise<{url?: string, error?: string}>} */
export const fetchDropboxAuthUrl = () => scriptGet('getDropboxAuthUrl');

export const setDropboxCredentials = (appKey, appSecret) =>
  scriptPost({ action: 'setDropboxCredentials', appKey, appSecret });

export const disconnectDropbox = () => scriptPost({ action: 'disconnectDropbox' });

export const refreshDropboxProofsNow = () => scriptPost({ action: 'refreshDropboxProofsNow' });
