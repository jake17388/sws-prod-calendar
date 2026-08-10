import { expect, test } from '@playwright/test';

const today = new Date().toISOString().slice(0, 10);
const job = {
  jobKey: '260001', jobNum: '260001', title: 'Browser Test Job',
  startDate: today, endDate: today, dueDate: today, autoDueDate: today,
  dueOverride: '', multiDay: false, crew: [], completed: false,
  notes: [], checklist: [], departments: [], currentDepartments: [],
  departmentChecklists: {}, additionalFiles: [], updatedAt: '2026-08-10T12:00:00.000Z',
};

async function mockBackend(page, { mustChangePin = false, department = 'Admin' } = {}) {
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
      body = { ok: true, token: 'eyJ1aWQiOiJhZG1pbiJ9.signature', userId: 'admin', user: 'Test User', department, canManageUsers: department === 'Admin', mustChangePin };
    } else if (action === 'getProductionJobs') {
      body = { jobs: [currentJob], version: 1 };
    } else if (action === 'getTrackingVersion') {
      body = { version: 1 };
    } else if (action === 'getProofFile') {
      body = { available: false };
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
