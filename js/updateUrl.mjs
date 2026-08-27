export function updateReloadUrl(currentUrl, cacheBuster = Date.now()) {
  const url = new URL(currentUrl);
  url.searchParams.set('v', String(cacheBuster));
  return url.toString();
}

export function cleanUpdateUrl(currentUrl) {
  const url = new URL(currentUrl);
  if (!url.searchParams.has('v')) return currentUrl;
  url.searchParams.delete('v');
  return url.toString();
}
