export function buildScriptGetRequest(baseUrl, action, token, extraParams = {}, requestOptions = {}) {
  const params = new URLSearchParams({ action, token, ...extraParams });
  if (requestOptions.cacheBust) {
    params.set('_', String(requestOptions.nonce ?? Date.now()));
  }
  return {
    url: `${baseUrl}?${params.toString()}`,
    options: { cache: 'no-store' },
  };
}
