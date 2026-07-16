const HEADER_SELECTOR = 'header.app-header';

/** Dims/undims the header to match the rest of the page while a modal/panel is open. */
export function setHeaderDimmed(dimmed) {
  const header = document.querySelector(HEADER_SELECTOR);
  if (header) header.classList.toggle('overlay-dimmed', dimmed);
}
