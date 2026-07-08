import { SCRIPT_URL } from './config.js';
import { getAuth, signOut } from './auth.js';

/** @param {string} action @returns {Promise<any>} */
export function scriptGet(action, extraParams = {}) {
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

export const updateChecklist = (jobKey, checklist) =>
  scriptPost({ action: 'updateChecklist', jobKey, checklist });
