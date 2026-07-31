// Shared HTML escaping. Previously each component defined its own local
// escapeHtml() — three near-identical copies — and all three had the same
// hole: they escape for TEXT content, not for ATTRIBUTE values, but were used
// inside quoted attributes.
//
// escapeHtml() below is the textContent→innerHTML trick, which escapes &, <
// and > but NOT the double quote. Interpolated into `value="${...}"` that lets
// a stored value containing a quote close the attribute early and inject its
// own — e.g. a user named `" onfocus=alert(1) autofocus="`. One caller was
// worse still, hand-rolling `.replace(/"/g, '&quot;')`, which escapes the
// quote but not the ampersand — so the literal text `&quot;` decoded back to a
// real quote on parse and broke out anyway.
//
// Use escapeHtml for text between tags, escapeAttr for anything inside a
// quoted attribute value. escapeAttr handles & first (order matters — escaping
// it after the others would double-escape their output).

/** @param {unknown} str @returns {string} safe for use as element text content */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

/** @param {unknown} str @returns {string} safe for use inside a quoted HTML attribute value */
export function escapeAttr(str) {
  return (str == null ? '' : String(str))
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
