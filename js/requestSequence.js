// Guards against out-of-order async responses clobbering newer optimistic
// state — e.g. rapidly toggling a checkbox fires overlapping save requests,
// and a slow-to-resolve earlier request can land AFTER a faster later one,
// silently reverting the checkbox to the stale value. Each caller stamps
// its request with a token from beginRequest(key); the response handler
// only applies its result if isLatestRequest(key, token) is still true,
// i.e. no newer request for that same key has been issued since.
const latestToken = new Map();

/** @param {string} key @returns {number} token to check with isLatestRequest once the async call settles */
export function beginRequest(key) {
  const token = (latestToken.get(key) || 0) + 1;
  latestToken.set(key, token);
  return token;
}

/** @param {string} key @param {number} token @returns {boolean} whether `token` is still the most recently issued request for `key` */
export function isLatestRequest(key, token) {
  return latestToken.get(key) === token;
}
