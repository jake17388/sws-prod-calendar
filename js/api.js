import { SCRIPT_URL } from './config.js';
import { getAuth, signOut } from './auth.js';
import { beginWrite, endWrite } from './pendingWrites.mjs';

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
  const requestId = globalThis.crypto && globalThis.crypto.randomUUID
    ? globalThis.crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload = body.action === 'login' ? body : { requestId, ...body, token: auth ? auth.token : '' };
  const tracksPendingWrite = body.action !== 'login';
  if (tracksPendingWrite) beginWrite();
  return fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(checkAuthError)
    .finally(() => { if (tracksPendingWrite) endWrite(); });
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

export const fetchArchivedJobs = (query = '') =>
  scriptGet('getArchivedJobs', { q: query }).then(d => {
    if (d.error) throw new Error(d.error);
    return d.jobs || [];
  });

export const toggleComplete = (jobKey, completed, archiveSnapshot = null) =>
  scriptPost({ action: 'toggleComplete', jobKey, completed, archiveSnapshot });

/** @param {string} dueDate "YYYY-MM-DD", or '' to clear the override and revert to the calculated date */
export const updateDueDate = (jobKey, dueDate) =>
  scriptPost({ action: 'updateDueDate', jobKey, dueDate });

export const fetchUsers = () => scriptGet('getUsers').then(d => d.users || []);

export const fetchCommonTasks = () => scriptGet('getCommonTasks').then(d => d.tasks || []);

export const saveCommonTasks = tasks =>
  scriptPost({ action: 'saveCommonTasks', tasks });

/** The signed-in user's own PIN. Fetched on demand so it's never persisted client-side. @returns {Promise<string>} */
export const addUser = (name, department, pin) =>
  scriptPost({ action: 'addUser', name, department, pin });

/** @param {string} id @param {{name?: string, department?: string, pin?: string}} patch */
export const updateUser = (id, patch) =>
  scriptPost({ action: 'updateUser', id, ...patch });

export const deleteUser = id =>
  scriptPost({ action: 'deleteUser', id });

export const revokeUserSessions = id =>
  scriptPost({ action: 'revokeUserSessions', id });

/** @param {{name?: string, pin?: string}} patch — updates the signed-in user's own name/PIN */
export const updateSelf = patch =>
  scriptPost({ action: 'updateSelf', ...patch });

/** @param {string} jobKey @param {string[]} departments @param {Record<string, {id: string, text: string, done: boolean}[]>} departmentChecklists @param {string[]} currentDepartments @param {string} expectedUpdatedAt — the job's updatedAt as last read; server rejects with a 'conflict' if it's since moved */
export const updateJobDepartments = (jobKey, departments, departmentChecklists, currentDepartments, expectedUpdatedAt) =>
  scriptPost({ action: 'updateJobDepartments', jobKey, departments, departmentChecklists, currentDepartments, expectedUpdatedAt });

/** @param {string} jobKey @param {string} department @param {string} itemId @param {boolean} done */
export const toggleDepartmentTaskDone = (jobKey, department, itemId, done) =>
  scriptPost({ action: 'toggleDepartmentTaskDone', jobKey, department, itemId, done });

/** @param {string} jobKey @param {string} text @param {string} noteId client-generated id used for optimistic reconciliation */
export const addNote = (jobKey, text, noteId) =>
  scriptPost({ action: 'addNote', jobKey, scope: 'project', text, noteId });

/** @param {string} jobKey @param {string} noteId @param {string} text */
export const updateNote = (jobKey, noteId, text) =>
  scriptPost({ action: 'updateNote', jobKey, scope: 'project', noteId, text });

/** @param {string} jobKey @param {string} noteId */
export const deleteNote = (jobKey, noteId) =>
  scriptPost({ action: 'deleteNote', jobKey, scope: 'project', noteId });

/** @param {string} jobNum @returns {Promise<{available: boolean, name?: string, base64?: string}>} */
export const fetchProofFile = jobNum => scriptGet('getProofFile', { jobNum });

/** @param {string} jobKey @param {{name: string, type: string}} file @param {string} base64 */
export const uploadAdditionalFile = (jobKey, file, base64) =>
  scriptPost({ action: 'addAdditionalFile', jobKey, name: file.name, mimeType: file.type, base64 });

export const fetchAdditionalFile = (jobKey, fileId) =>
  scriptGet('getAdditionalFile', { jobKey, fileId });

export const deleteAdditionalFile = (jobKey, fileId) =>
  scriptPost({ action: 'deleteAdditionalFile', jobKey, fileId });

export const fetchSquarecoilStatus = () => scriptGet('getSquarecoilStatus');

export const fetchSystemHealth = () => scriptGet('getSystemHealth');

export const refreshSquarecoilFilesNow = () => scriptPost({ action: 'refreshSquarecoilFilesNow' });
