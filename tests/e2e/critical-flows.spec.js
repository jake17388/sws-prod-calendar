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

async function mockBackend(page, { mustChangePin = false, department = 'Admin', productionPdf = null, expectedPin = null } = {}) {
  let currentJob = structuredClone(job);
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
        : { ok: true, token: 'eyJ1aWQiOiJhZG1pbiJ9.signature', userId: 'admin', user: 'Test User', department, canManageUsers: department === 'Admin', mustChangePin };
    } else if (action === 'getProductionJobs') {
      body = { jobs: [currentJob], version: 1 };
    } else if (action === 'getTrackingVersion') {
      body = { version: 1 };
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
    } else if (action === 'getDropboxStatus') {
      body = { connected: false, hasCredentials: false };
    } else if (action === 'getSystemHealth') {
      body = { healthy: true, backup: { current: true, lastAt: '2026-08-10T11:00:00.000Z', triggerInstalled: true }, trackingConfigured: true, lastFailure: null };
    } else if (action === 'getUsers') {
      body = { users: [{ id: 'worker', name: 'Alex Worker', department: 'Paint', pin: '000001', mustChangePin: true }] };
    } else if (action === 'addNote') {
      currentJob = { ...currentJob, notes: [{ id: payload.noteId, text: payload.text, author: 'Test Admin', authorId: 'admin', createdAt: '2026-08-10T12:01:00.000Z' }], updatedAt: '2026-08-10T12:01:00.000Z' };
      body = { success: true, notes: currentJob.notes, updatedAt: currentJob.updatedAt };
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

test('a production PDF opens from original bytes and can be re-rendered at higher zoom', async ({ page }) => {
  await mockBackend(page, { productionPdf: onePagePdfBase64() });
  await login(page);
  await page.getByRole('button', { name: /Open 260001/ }).click();
  await page.getByRole('button', { name: 'View Production File' }).click();
  await expect(page.locator('.proof-viewer-page')).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('#proof-viewer-zoom-label')).toHaveText('125%');
  await expect(page.locator('#proof-viewer-open-original')).toHaveAttribute('href', /^blob:/);
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
  await expect(page.getByText('Temporary PIN', { exact: true })).toBeVisible();
});
