import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('authenticated workspace exposes a branded, icon-led responsive navigation shell', () => {
  const html = read('index.html');

  assert.match(html, /class="app-ambient"/);
  assert.match(html, /class="brand-eyebrow">Production workspace</);
  assert.match(html, /class="view-switcher desktop-view-switcher"/);
  assert.match(html, /class="view-switcher mobile-view-switcher"/);
  assert.match(html, /class="nav-icon"/);
  assert.match(html, /aria-label="Refresh production jobs"/);
});

test('premium visual system provides depth, responsive dock navigation, and restrained motion', () => {
  const tokens = read('styles/tokens.css');
  const layout = read('styles/layout.css');
  const calendar = read('styles/calendar.css');
  const cards = read('styles/job-card.css');

  assert.match(tokens, /--font-display:/);
  assert.match(tokens, /--surface-glass:/);
  assert.match(tokens, /--shadow-premium:/);
  assert.match(layout, /\.app-ambient/);
  assert.match(layout, /\.mobile-view-switcher/);
  assert.match(layout, /@media \(max-width: 700px\)[\s\S]*\.desktop-view-switcher\s*\{\s*display:\s*none/);
  assert.match(layout, /@media \(max-width: 700px\)[\s\S]*\.mobile-view-switcher\s*\{[\s\S]*display:\s*grid/);
  assert.match(layout, /main\.view-area\.view-enter/);
  assert.match(calendar, /\.month-grid[\s\S]*border-radius:/);
  assert.match(cards, /\.job-card::after/);
});

test('view navigation uses a lightweight animation class without delaying rendering', () => {
  const app = read('js/app.js');

  assert.match(app, /container\.classList\.remove\('view-enter'\)/);
  assert.match(app, /requestAnimationFrame/);
  assert.doesNotMatch(app, /setTimeout\([^)]*renderActiveView/);
});

test('desktop work views form a right-aligned companion switcher and the role badge is vertically centered', () => {
  const html = read('index.html');
  const layout = read('styles/layout.css');

  assert.match(
    html,
    /class="view-switcher work-view-switcher"[\s\S]*id="view-btn-other-production"[\s\S]*id="view-btn-assign"[\s\S]*id="view-btn-hours-log"[\s\S]*<\/div>[\s\S]*<\/div>\s*<div class="nav-row">/,
  );
  assert.match(layout, /\.dept-badge\s*\{[\s\S]{0,240}display:\s*inline-flex;[\s\S]{0,160}align-items:\s*center;/);
  assert.match(layout, /\.desktop-view-switcher,\s*\.work-view-switcher\s*\{/);
  assert.match(layout, /\.desktop-view-switcher button,\s*\.work-view-switcher button\s*\{/);
  assert.match(layout, /\.desktop-view-switcher button\.active,\s*\.work-view-switcher button\.active\s*\{/);
});
