import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { signInThroughManagedLogin } from '../fixtures/cognito.js';

const items = JSON.parse(readFileSync(new URL('../../backend/fixtures/scholarships.json', import.meta.url), 'utf8'));
const response = { items, total: items.length, nextOffset: null };
const endpoint = 'http://127.0.0.1:8000/scholarships?*';

test('API discovery shows loading then two fictional records with private actions disabled', async ({ page }) => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  await page.route(endpoint, async route => { await ready; await route.fulfill({ json: response }); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading scholarships?', { exact: true })).toBeVisible();
  } finally { release(); }
  await expect(page.locator('.scholarship-card')).toHaveCount(2);
  await expect(page.getByText('Loading scholarships?', { exact: true })).toHaveCount(0);
  for (const card of await page.locator('.scholarship-card').all()) {
    await expect(card.getByRole('button', { name: /^Save / })).toBeDisabled();
  }
  await page.getByLabel('Country', { exact: true }).selectOption('Japan');
  await page.getByRole('button', { name: 'View details' }).click();
  await expect(page.getByRole('dialog')).toContainText('Sample Japan Graduate Award');
  await expect(page.getByRole('button', { name: 'Track application', exact: true })).toBeDisabled();
});

test('API failure shows retry without demo fallback and retry recovers the two records', async ({ page }) => {
  let failed = true;
  await page.route(endpoint, route => route.fulfill(failed
    ? { status: 503, json: { message: 'Temporary scholarship outage' } }
    : { json: response }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('alert')).toContainText('Temporary scholarship outage');
  await expect(page.locator('.scholarship-card')).toHaveCount(0);
  await expect(page.getByText('No scholarships found.', { exact: true })).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.scholarship-card')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Cognito sign-in and logout coexist with API discovery without requesting account APIs', async ({ page }) => {
  const accountRequests = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/me') accountRequests.push(request.url()); });
  await signInThroughManagedLogin(page);
  await expect(page.locator('.scholarship-card')).toHaveCount(2);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'My workspace', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  await expect(page.locator('.scholarship-card')).toHaveCount(2);
  expect(accountRequests).toEqual([]);
});
