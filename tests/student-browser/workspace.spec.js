import { test, expect } from '@playwright/test';
import { database, login, openProfile, trackJapan } from '../fixtures/student.js';

test('server profile overrides local cache, maps degrees, and survives reload without local upload', async ({ page }) => {
  const db = database();
  await page.addInitScript(() => {
    if (!localStorage.getItem('scholarrise-platform-v1')) localStorage.setItem('scholarrise-platform-v1', JSON.stringify({
      users: [{ id: 'oidc-student-sub', cognito: true, name: 'Untrusted local name', role: 'admin', profile: { gpa: 4 } }],
      scholarships: [], applications: [], bookmarks: { 'oidc-student-sub': ['legacy-id'] }, dismissed: {},
    }));
  });
  await login(page, db); await openProfile(page);
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Remote Student');
  expect(db.writes).toEqual([]);
  await page.getByLabel('Full name', { exact: true }).fill('Cloud Student');
  await page.locator('select[name=degree]').selectOption("Master's");
  await page.getByLabel('Current GPA (0\u20134)').fill('3.75');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect.poll(() => db.users.get('oidc-student-sub').version).toBe(2);
  expect(db.writes[0].body.degree).toBe("Master's"); expect(db.writes[0].body.gpa).toBe(3.75);
  expect(db.writes[0].body.role).toBeUndefined();
  await page.reload({ waitUntil: 'domcontentloaded' }); await openProfile(page);
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Cloud Student');
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem('scholarrise-platform-v1')));
  expect(local.users[0].name).toBe('Untrusted local name'); expect(local.bookmarks['oidc-student-sub']).toEqual(['legacy-id']);
});

test('saved awards and application edits persist across reload and a separate browser session', async ({ page, browser }) => {
  const db = database(); await login(page, db);
  await page.getByRole('button', { name: 'Save Sample Japan Graduate Award', exact: true }).click();
  await expect.poll(() => db.saved.get('oidc-student-sub').size).toBe(1);
  await trackJapan(page, db);
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Preparing');
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('Preparing');
  await page.getByLabel('Application notes').fill('Cloud-only test note');
  await page.getByLabel('Application notes').press('Tab');
  await expect.poll(() => db.apps.get('oidc-student-sub').get('local-japan-award').notes).toBe('Cloud-only test note');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'My workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Application tracking', exact: true }).click();
  await expect(page.getByLabel('Application notes')).toHaveValue('Cloud-only test note');
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin }); const second = await context.newPage();
  try {
    await login(second, db);
    await expect(second.getByRole('button', { name: 'Unsave Sample Japan Graduate Award', exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Unsave Sample Japan Graduate Award', exact: true }).click();
    await expect.poll(() => db.saved.get('oidc-student-sub').size).toBe(0);
    await second.getByRole('button', { name: 'My workspace', exact: true }).click();
    await second.getByRole('button', { name: 'Application tracking', exact: true }).click();
    await second.getByRole('button', { name: 'Remove from tracker', exact: true }).click();
    await second.getByRole('button', { name: 'Remove application', exact: true }).click();
    await expect.poll(() => db.apps.get('oidc-student-sub').size).toBe(0);
  } finally { await context.close(); }
});

test('profile and application conflicts refresh latest data and require explicit retry', async ({ page }) => {
  const db = database(); await login(page, db); await openProfile(page); db.conflict = 'profile';
  await page.getByLabel('Full name', { exact: true }).fill('Stale edit');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Another session');
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Changed elsewhere');
  expect(db.writes.length).toBe(1);
  await page.getByRole('button', { name: 'Retry workspace' }).click();
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Browse scholarships' }).click(); await trackJapan(page, db);
  db.conflict = 'application';
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Preparing');
  await expect(page.getByRole('alert')).toContainText('Another session');
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('Submitted');
  await expect(page.getByLabel('Application notes')).toHaveValue('Other session note');
});

test('logout clears private state and a different student never inherits saved records or notes', async ({ page }) => {
  const db = database(); await login(page, db);
  await page.getByRole('button', { name: 'Save Sample Japan Graduate Award', exact: true }).click();
  await expect.poll(() => db.saved.get('oidc-student-sub').size).toBe(1);
  await trackJapan(page, db);
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unsave Sample Japan Graduate Award' })).toHaveCount(0);
  await login(page, db, 'other-student-sub');
  await page.getByRole('button', { name: 'My workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Application tracking', exact: true }).click();
  await expect(page.getByLabel('Application notes')).toHaveCount(0);
});

test('expired token restores with refresh; backend 401 clears access and missing accounts are denied', async ({ page }) => {
  const db = database(), provider = await login(page, db);
  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('scholarrise.oidc.user.'));
    const user = JSON.parse(sessionStorage.getItem(key)); user.expires_at = Math.floor(Date.now() / 1000) - 1;
    sessionStorage.setItem(key, JSON.stringify(user));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'My workspace', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Sample Japan Graduate Award', exact: true })).toBeEnabled();
  expect(provider.tokenRequests()).toBe(2);
  db.reject = 401;
  await page.getByRole('button', { name: 'Save Sample Japan Graduate Award', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  expect(db.saved.get('oidc-student-sub').size).toBe(0);
  db.reject = 0; db.missing = true; await login(page, db, 'oidc-student-sub', false);
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  await expect(page.getByRole('button', { name: 'My workspace', exact: true })).toHaveCount(0);
});

test('workspace failure has a retry state and never substitutes local data', async ({ page }) => {
  const db = database(); db.failRead = true;
  await login(page, db, 'oidc-student-sub', false);
  await expect(page.getByRole('alert')).toContainText('Could not update your workspace');
  await expect(page.getByRole('button', { name: 'Save Sample Japan Graduate Award', exact: true })).toBeDisabled();
  db.failRead = false; await page.getByRole('button', { name: 'Retry workspace' }).click();
  await expect(page.getByRole('button', { name: 'Save Sample Japan Graduate Award', exact: true })).toBeEnabled();
  expect(db.writes).toEqual([]);
});
