import { test, expect } from '@playwright/test';
import { mockCognito, signInThroughManagedLogin } from '../fixtures/cognito.js';

test('legacy browser session cannot authenticate and invalid callback fails closed', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('scholarrise-session', 'demo-admin'));
  await page.goto('/?code=synthetic&state=unknown', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('alert')).toContainText('Sign-in could not be completed');
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'My workspace' })).toHaveCount(0);
  await expect(page).toHaveURL('http://127.0.0.1:5175/');
});

test('unverified email cannot open a workspace', async ({ page }) => {
  await mockCognito(page, { verified: false });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('link', { name: 'Complete secure sign-in' }).click();
  await expect(page.getByRole('alert')).toContainText('Verify your email');
  await expect(page.getByRole('button', { name: 'My workspace' })).toHaveCount(0);
});

test('password recovery opens Cognito and returns through the PKCE callback', async ({ page }) => {
  await mockCognito(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await expect(page.getByRole('heading')).toHaveText('Mock Cognito password recovery');
  await page.getByRole('link', { name: 'Complete secure sign-in' }).click();
  await expect(page.getByRole('button', { name: 'My workspace' })).toBeVisible();
});

test('failed trusted account lookup denies workspace access', async ({ page }) => {
  await mockCognito(page);
  await page.route('http://127.0.0.1:5190/**', route => route.fulfill({
    status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, json: { message: 'Disabled account' },
  }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('link', { name: 'Complete secure sign-in' }).click();
  await expect(page.getByRole('alert')).toContainText('Your account could not be verified');
  await expect(page.getByRole('button', { name: 'My workspace' })).toHaveCount(0);
});

test('changing cached student role to admin cannot grant staff access', async ({ page }) => {
  await signInThroughManagedLogin(page);
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('scholarrise-platform-v1'));
    const account = store.users.find(user => user.id === 'oidc-student-sub');
    account.role = 'admin';
    localStorage.setItem('scholarrise-platform-v1', JSON.stringify(store));
    sessionStorage.setItem('scholarrise-session', 'demo-admin');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'My workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Student profile', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Administrator dashboard', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'University dashboard', exact: true })).toHaveCount(0);
});

