import { expect, test } from '@playwright/test';

const today = new Date().toISOString().slice(0, 10);
const job = {
  jobKey: '260001', jobNum: '260001', title: 'Browser Test Job',
  startDate: today, endDate: today, dueDate: today, autoDueDate: today,
  dueOverride: '', multiDay: false, crew: [], completed: false,
  notes: [], checklist: [], departments: [], currentDepartments: [],
  departmentChecklists: {}, additionalFiles: [], updatedAt: '2026-08-10T12:00:00.000Z',
};

function onePagePdfBase64() {
  const objects = [
    '1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n',
    '2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n',
    '3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>>\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += object;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf).toString('base64');
}

async function mockBackend(page, { mustChangePin = false, department = 'Admin', user = 'Test User', productionPdf = null, expectedPin = null, jobDueDate = null, jobTimeDelayMs = 0, jobTitle = null, jobDepartments = null, currentDepartments = null } = {}) {
  let currentJob = { ...structuredClone(job), ...(jobDueDate ? { dueDate: jobDueDate } : {}), ...(jobTitle ? { title: jobTitle } : {}) };
  if (['Manufacturing', 'Graphics', 'Routing', 'Paint', 'Letters', 'Assembly'].includes(department)) {
    currentJob = {
      ...currentJob,
      departments: [department],
      currentDepartments: [department],
      departmentChecklists: { [department]: [{ id: 'task-1', text: 'Open production task', done: false }] },
    };
  }
  if (jobDepartments) {
    currentJob = {
      ...currentJob,
      departments: jobDepartments,
      currentDepartments: currentDepartments || [],
      departmentChecklists: Object.fromEntries(jobDepartments.map(role => [role, []])),
    };
  }
  let activeJobTime = null;
  await page.route(/https:\/\/script\.google\.com\/macros\/s\/.*\/exec(?:\?.*)?$/, async route => {
    const request = route.request();
    let action;
    let payload = {};
    if (request.method() === 'POST') {
      payload = JSON.parse(request.postData() || '{}');
      action = payload.action;
    } else {
      action = new URL(request.url()).searchParams.get('action');
    }

    let body;
    if (action === 'login') {
      body = expectedPin && payload.pin !== expectedPin
        ? { ok: false }
        : { ok: true, token: 'eyJ1aWQiOiJhZG1pbiJ9.signature', userId: 'admin', user, department, canManageUsers: department === 'Admin', mustChangePin };
    } else if (action === 'getProductionJobs') {
      body = { jobs: [currentJob], version: 1 };
    } else if (action === 'getTrackingVersion') {
      body = { version: 1 };
    } else if (action === 'getJobTimeStatus') {
      body = { success: true, active: activeJobTime };
    } else if (action === 'lookupSquarecoilJob') {
      const jobNum = new URL(request.url()).searchParams.get('jobNum');
      body = { success: true, found: true, job: { jobNum, name: 'Squarecoil Other Job' } };
    } else if (action === 'getProofFile') {
      body = productionPdf
        ? { available: true, name: '260001-production.pdf', base64: productionPdf }
        : { available: false };
    } else if (action === 'getAdditionalFile') {
      body = {
        available: true,
        name: 'install-photo.jpg',
        mimeType: 'image/png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      };
    } else if (action === 'getCommonTasks') {
      body = { tasks: [] };
    } else if (action === 'getSquarecoilStatus') {
      body = { connected: false, hasCredentials: false };
    } else if (action === 'getSystemHealth') {
      body = { healthy: true, backup: { current: true, lastAt: '2026-08-10T11:00:00.000Z', triggerInstalled: true }, trackingConfigured: true, lastFailure: null };
    } else if (action === 'getArchivedJobs') {
      body = {
        jobs: [{
          jobKey: '250999', jobNum: '250999', title: 'Downtown Museum Monument', addr: '100 Main St',
          crew: ['Jake'], startDate: '2026-06-12', endDate: '2026-06-12', dueDate: '2026-06-10',
          autoDueDate: '2026-06-10', dueOverride: '', multiDay: false, completed: true,
          completedAt: '2026-06-10T16:30:00.000Z', completedBy: 'Test Admin',
          notes: [{ id: 'archive-note', text: 'Museum monument ready for pickup', author: 'Alex', createdAt: '2026-06-10T15:00:00.000Z' }],
          checklist: [], departments: ['Paint'], currentDepartments: [],
          departmentChecklists: { Paint: [{ id: 'paint-1', text: 'Paint faces', done: true }] },
          additionalFiles: [], updatedAt: '2026-06-10T16:30:00.000Z',
        }],
      };
    } else if (action === 'getUsers') {
      body = { users: [{ id: 'worker', name: 'Alex Worker', department: 'Paint', pin: '000001', mustChangePin: true }] };
    } else if (action === 'updateUser') {
      body = {
        success: true,
        user: {
          id: payload.id,
          name: 'Alex Worker',
          department: 'Paint',
          pin: payload.pin,
          mustChangePin: payload.temporaryPin !== false,
        },
      };
    } else if (action === 'addNote') {
      currentJob = { ...currentJob, notes: [{ id: payload.noteId, text: payload.text, author: 'Test Admin', authorId: 'admin', createdAt: '2026-08-10T12:01:00.000Z' }], updatedAt: '2026-08-10T12:01:00.000Z' };
      body = { success: true, notes: currentJob.notes, updatedAt: currentJob.updatedAt };
    } else if (action === 'startJobTime') {
      if (jobTimeDelayMs) await new Promise(resolve => setTimeout(resolve, jobTimeDelayMs));
      activeJobTime = {
        entryId: `entry-${payload.jobNum}`,
        userId: 'admin',
        employee: 'Test User',
        department,
        jobNum: payload.jobNum,
        jobName: payload.source === 'other' ? 'Squarecoil Other Job' : currentJob.title,
        source: payload.source,
        startedAt: '2026-08-24T14:00:00.000Z',
      };
      body = { success: true, active: activeJobTime };
    } else if (action === 'stopJobTime') {
      if (jobTimeDelayMs) await new Promise(resolve => setTimeout(resolve, jobTimeDelayMs));
      activeJobTime = null;
      body = { success: true, stopped: true, active: null };
    } else if (action === 'addAdditionalFile') {
      currentJob = {
        ...currentJob,
        additionalFiles: [{
          id: 'file-1', name: payload.name, mimeType: payload.mimeType,
          size: Buffer.from(payload.base64, 'base64').length,
          addedBy: 'Test User', addedById: 'admin', addedAt: '2026-08-10T12:02:00.000Z',
        }],
        updatedAt: '2026-08-10T12:02:00.000Z',
      };
      body = { success: true, additionalFiles: currentJob.additionalFiles, updatedAt: currentJob.updatedAt };
    } else if (action === 'updateSelf') {
      body = { success: true, user: { id: 'admin', name: 'Test Admin', department: 'Admin', mustChangePin: false }, token: 'eyJ1aWQiOiJhZG1pbiJ9.replacement' };
    } else {
      body = { success: true };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
}

async function login(page) {
  await page.goto('/');
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click();
  await expect(page.locator('#pin-screen')).toBeHidden();
  await expect(page.locator('#app')).toBeVisible();
}

test('rapid touch entry captures every PIN digit without waiting between taps', async ({ page }) => {
  await mockBackend(page, { expectedPin: '123456' });
  await page.goto('/');

  await page.evaluate(() => {
    for (const digit of '123456') {
      const button = document.querySelector(`.pin-pad button[data-digit="${digit}"]`);
      button.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        isPrimary: true,
      }));
      // iOS may follow a pointer sequence with a compatibility click. It must
      // not enter the same digit a second time.
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    }
  });

  await expect(page.locator('#pin-screen')).toBeHidden();
  await expect(page.locator('#app')).toBeVisible();
});

test('an Admin can sign in, open a job, and add a note immediately', async ({ page }) => {
  await mockBackend(page);
  await login(page);
  await expect(page.getByText('Browser Test Job')).toBeVisible();
  await page.getByRole('button', { name: /Open 260001/ }).click();
  await page.getByRole('button', { name: '+ Add note' }).click();
  await page.getByPlaceholder('Add a note…').fill('Ready for production');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Ready for production')).toBeVisible();
  await expect(page.getByText('Saving…')).toHaveCount(0);
});

test('a signed-in user can search archived jobs and open their retained history', async ({ page }) => {
  await mockBackend(page);
  await login(page);
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('heading', { name: 'Archived Jobs' })).toBeVisible();
  await page.getByLabel('Search archived jobs').fill('museum');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Downtown Museum Monument')).toBeVisible();
  await page.getByRole('button', { name: /Open 250999/ }).click();
  await expect(page.getByRole('heading', { name: /250999/ })).toBeVisible();
  await expect(page.getByText('Museum monument ready for pickup')).toBeVisible();
});

test('a current-week Production File opens full quality and zooms inside the app', async ({ page }) => {
  await mockBackend(page, { productionPdf: onePagePdfBase64() });
  await login(page);
  await page.getByRole('button', { name: /Open 260001/ }).click();
  await expect(page.getByRole('button', { name: 'View Production File' }))
    .toHaveAttribute('data-viewer-mode', 'preview');
  await page.getByRole('button', { name: 'View Production File' }).click();
  await expect(page.locator('#proof-viewer-overlay')).toHaveClass(/open/);
  await expect(page.locator('.proof-viewer-page')).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('#proof-viewer-zoom-label')).toHaveText('125%');
});

test('a Production File three weeks out uses the same in-app source-quality viewer', async ({ page }) => {
  const later = new Date();
  later.setDate(later.getDate() + 21);
  await mockBackend(page, { productionPdf: onePagePdfBase64(), jobDueDate: later.toISOString().slice(0, 10) });
  await login(page);
  for (let week = 0; week < 3; week++) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Open 260001/ }).click();
  await page.getByRole('button', { name: 'View Production File' }).click();
  await expect(page.locator('.proof-viewer-page')).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('#proof-viewer-zoom-label')).toHaveText('125%');
  await expect(page.locator('#proof-viewer-open-original')).toHaveCount(0);
});

test('a Viewer can add to the same project notes timeline', async ({ page }) => {
  await mockBackend(page, { department: 'Viewer' });
  await login(page);
  await expect(page.getByText('Browser Test Job')).toBeVisible();
  await page.getByRole('button', { name: /Open 260001/ }).click();
  await page.getByRole('button', { name: '+ Add note' }).click();
  await page.getByPlaceholder('Add a note…').fill('Viewer update');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Viewer update')).toBeVisible();
});

test('a TV account shows only a compact, readable current-week display', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mockBackend(page, {
    department: 'TV',
    user: 'Prod TV',
    jobTitle: 'Canyon Ridge Community Center Monument and Directional Sign Package',
    jobDepartments: ['Assembly', 'Paint'],
    currentDepartments: ['Assembly'],
  });
  await login(page);

  await expect(page.locator('body')).toHaveClass(/tv-mode/);
  await expect(page.locator('.week-grid')).toBeVisible();
  await expect(page.getByText('Canyon Ridge Community Center Monument and Directional Sign Package')).toBeVisible();
  await expect(page.locator('.toolbar-row')).toBeHidden();
  await expect(page.locator('.nav-row')).toBeHidden();
  await expect(page.locator('.mobile-view-switcher')).toBeHidden();
  await expect(page.locator('#stats-bar')).toBeHidden();
  await expect(page.locator('#header-count')).toBeHidden();
  await expect(page.locator('.job-card-dept-badges')).toBeVisible();
  await expect(page.locator('.job-card-dept-badge', { hasText: 'Assembly' })).toBeVisible();
  await expect(page.locator('.job-card-dept-badge', { hasText: 'Paint' })).toBeVisible();
  await expect(page.locator('.job-card-dept-badge-wrap', { hasText: 'Assembly' }).locator('.job-card-dept-current-dot')).toBeVisible();
  await expect(page.locator('.job-card-dept-badge-wrap', { hasText: 'Paint' }).locator('.job-card-dept-current-dot')).toHaveCount(0);

  const dayWidths = await page.locator('.week-day-col').evaluateAll(columns =>
    columns.map(column => column.getBoundingClientRect().width));
  expect(dayWidths[1]).toBeGreaterThan(dayWidths[0] * 2.5);
  expect(dayWidths[5]).toBeGreaterThan(dayWidths[6] * 2.5);

  const order = await page.locator('.header-user-cluster > *').evaluateAll(elements =>
    elements.map(element => element.id).filter(Boolean));
  expect(order.indexOf('last-updated')).toBeLessThan(order.indexOf('refresh-btn'));
  expect(order.indexOf('refresh-btn')).toBeLessThan(order.indexOf('user-badge'));
  await expect(page.locator('.job-card-title')).toHaveCSS('-webkit-line-clamp', 'none');
});

test('a production employee starts an assigned job, switches to a Squarecoil job, and stops work', async ({ page }) => {
  await mockBackend(page, { department: 'Paint', jobTimeDelayMs: 800 });
  await login(page);

  await expect(page.getByRole('button', { name: 'Job Selector' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jobs to Assign' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'What job are you beginning work on?' })).toBeVisible();

  await page.getByRole('button', { name: /260001.*Browser Test Job/ }).click();
  await expect(page.getByText('260001 — Browser Test Job')).toBeVisible({ timeout: 250 });
  await expect(page.locator('#save-status')).toBeHidden();

  await page.getByRole('textbox', { name: 'Job number', exact: true }).fill('231180');
  await page.getByRole('button', { name: 'Look up job' }).click();
  await expect(page.getByText('231180 — Squarecoil Other Job')).toBeVisible();
  await page.getByRole('button', { name: 'Start this job' }).click();
  await expect(page.getByText('231180 — Squarecoil Other Job')).toBeVisible();

  await page.getByRole('button', { name: 'Stop Work' }).click();
  await expect(page.getByText('No active job')).toBeVisible({ timeout: 250 });
  await expect(page.locator('#save-status')).toBeHidden();
});

test('a Viewer can add an additional file with visible attribution but cannot delete it', async ({ page }) => {
  await mockBackend(page, { department: 'Viewer' });
  await login(page);
  await page.getByRole('button', { name: /Open 260001/ }).click();
  await page.locator('#job-detail-additional-input').setInputFiles({
    name: 'install-photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('test image'),
  });

  await expect(page.getByText('install-photo.jpg')).toBeVisible();
  await expect(page.locator('.additional-file-meta').filter({ hasText: 'Test User' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await page.getByRole('button', { name: 'View File' }).click();
  await expect(page.locator('#proof-viewer-overlay')).toBeVisible();
  await expect(page.locator('#proof-viewer-title')).toContainText('install-photo.jpg');
  await expect(page.locator('.file-viewer-image')).toBeVisible();
});

test('a temporary PIN forces My Account until the user replaces it', async ({ page }) => {
  await mockBackend(page, { mustChangePin: true });
  await login(page);
  await expect(page.getByRole('alert')).toContainText('temporary PIN');
  await page.getByLabel('New PIN').fill('654321');
  await page.getByRole('button', { name: 'Save my info' }).click();
  await expect(page.getByText('Your account is using a temporary PIN')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Close settings' })).toBeVisible();
});

test('User Management shows which accounts still have temporary PINs', async ({ page }) => {
  await mockBackend(page);
  await login(page);
  await expect(page.getByText('Browser Test Job')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'User Management' }).click();
  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
  await expect(page.locator('.user-row-training-status', { hasText: 'Temporary PIN' })).toBeVisible();
});

test('an Admin can reset an account with a regular PIN', async ({ page }) => {
  await mockBackend(page);
  await login(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'User Management' }).click();

  const row = page.getByRole('group', { name: /Alex Worker, Paint/ });
  await row.getByLabel('PIN type for Alex Worker').selectOption('regular');
  await row.locator('.user-row-pin').fill('654321');
  await row.locator('.user-row-pin').press('Tab');

  await expect(row.locator('.user-row-training-status')).toHaveCount(0);
  await expect(row.getByText('Regular PIN updated')).toBeVisible();
});
