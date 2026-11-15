import { test, expect } from '@playwright/test';
import { signInThroughManagedLogin, mockCognito } from '../fixtures/cognito.js';

test('Cognito sign-in, profile, recommendations, tracking, persistence and logout', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const controls = await signInThroughManagedLogin(page);
  await page.getByRole('button', { name: 'My workspace' }).click();
  await page.getByRole('button', { name: 'Complete my profile' }).click();
  await page.getByLabel('Current GPA (0\u20134)').fill('3.8');
  await page.getByLabel('Preferred destination').selectOption('United Kingdom');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  const award = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Global Excellence Scholarship' }) });
  await award.getByRole('button', { name: 'Track application' }).click();
  await page.getByRole('button', { name: 'Application tracking', exact: true }).click();
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Preparing');
  await page.getByLabel('Application notes').fill('Prepare sample transcript.');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'My workspace' }).click();
  await page.getByRole('button', { name: 'Application tracking', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('Preparing');
  expect(controls.tokenRequests()).toBe(1);
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'My workspace' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('university and administrator dashboards require a trusted account API role', async ({ page }) => {
  await signInThroughManagedLogin(page, { role: 'university', sub: 'oidc-university-sub' });
  await page.getByRole('button', { name: 'My workspace' }).click();
  await expect(page.getByRole('cell', { name: /Global Excellence Scholarship/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add scholarship', exact: true }).click();
  await page.getByLabel('Scholarship name').fill('Westbridge New Horizons Award');
  await page.getByLabel('Destination', { exact: true }).fill('United Kingdom');
  await page.getByLabel('Award (e.g. Full tuition)').fill('Full tuition');
  await page.getByLabel('Description', { exact: true }).fill('A fictional scholarship for promising students.');
  await page.getByRole('button', { name: 'Save scholarship', exact: true }).click();
  await expect(page.getByRole('cell', { name: /Westbridge New Horizons Award/ })).toBeVisible();
  await page.getByRole('button', { name: 'Browse scholarships' }).click();
  await expect(page.getByRole('heading', { name: 'Westbridge New Horizons Award' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  await signInThroughManagedLogin(page, { role: 'admin', sub: 'oidc-admin-sub' });
  await page.getByRole('button', { name: 'My workspace' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Westbridge New Horizons Award' });
  await expect(row).toContainText('Pending approval');
  await row.getByRole('button', { name: 'Approve and publish', exact: true }).click();
  await page.getByRole('button', { name: 'Browse scholarships' }).click();
  await expect(page.getByRole('heading', { name: 'Westbridge New Horizons Award' })).toBeVisible();
});

test('search, reminders, account separation and mobile layout with Cognito identity', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInThroughManagedLogin(page);
  await page.getByLabel('Search scholarships', { exact: true }).fill('Canada');
  await page.getByRole('button', { name: 'Find scholarships', exact: true }).click();
  await expect(page.locator('.scholarship-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear All Filters', exact: true }).click();
  await page.getByRole('button', { name: 'Save Global Excellence Scholarship', exact: true }).click();
  await page.getByRole('button', { name: '1 deadline reminders' }).click();
  await expect(page.getByRole('heading', { name: 'Global Excellence Scholarship' })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss reminder for Global Excellence Scholarship' }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.locator('nav').getByRole('button', { name: /Saved/ }).click();
  await expect(page.locator('.scholarship-card')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const width of [1440, 820, 390]) test('combined filters and detail return at width ' + width, async ({ page }) => {
 await page.setViewportSize({ width, height: 900 });
 await page.goto('/', { waitUntil: 'domcontentloaded' });
 await page.getByLabel('Country', { exact: true }).selectOption('United States');
 await page.getByLabel('Filter study level', { exact: true }).selectOption("Master's");
 await page.getByLabel('Funding', { exact: true }).selectOption('Fully Funded');
 await page.getByLabel('Search universities').fill('Northstar');
 await page.getByLabel('University', { exact: true }).selectOption('Northstar Institute of Technology');
 await page.getByLabel('Search scholarships', { exact: true }).fill('innovators');
 await expect(page.locator('.scholarship-card')).toHaveCount(1);
 await page.getByRole('button', { name: 'View details' }).click();
 await expect(page.getByRole('dialog')).toContainText("Master's, PhD");
 await expect(page.getByRole('dialog')).toContainText('Required documents');
 await page.getByRole('button', { name: 'Close dialog' }).click();
 await expect(page.getByLabel('Country', { exact: true })).toHaveValue('United States');
 await page.getByLabel('Filter study level', { exact: true }).selectOption("Bachelor's");
 await expect(page.locator('.empty-state')).toBeVisible();
 await page.getByRole('button', { name: 'Clear All Filters' }).click();
 await expect(page.locator('.scholarship-card')).toHaveCount(11);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('real Thai programs and official sources are available without clearing saved data', async ({ page }) => {
 await page.goto('/', { waitUntil: 'domcontentloaded' });
 await page.getByLabel('Country', { exact: true }).selectOption('Thailand');
 await expect(page.locator('.scholarship-card')).toHaveCount(6);
 await page.getByLabel('University', { exact: true }).selectOption('Asian Institute of Technology');
 await expect(page.locator('.scholarship-card')).toHaveCount(1);
 await page.getByRole('button', { name: 'View details' }).click();
 await expect(page.getByRole('dialog')).toContainText('31 Mar 2027');
 await expect(page.getByRole('link', { name: 'Official source', exact: true })).toHaveAttribute('href', 'https://ait.ac.th/financial/royal-thai-government-scholarships/');
 await page.getByRole('button', { name: 'Close dialog' }).click();
 await page.getByLabel('University', { exact: true }).selectOption('Chiang Mai University');
 await expect(page.locator('.scholarship-card')).toContainText('Check deadline');
 await page.reload({ waitUntil: 'domcontentloaded' });
 await page.getByLabel('Country', { exact: true }).selectOption('Thailand');
 await expect(page.locator('.scholarship-card')).toHaveCount(6);
});

for (const width of [320, 820, 1440]) test('redesigned homepage navigation and destination shortcuts at ' + width, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Find the funding.');
  await expect(page.getByRole('img', { name: 'Two university students walking together on a leafy campus' })).toBeVisible();
  const metrics = page.getByRole('region', { name: 'Current scholarship collection' });
  await expect(metrics.locator('.catalog-stat').first().locator('strong')).toHaveText('11');
  await page.locator('.destination-links').getByRole('button', { name: 'Thailand', exact: false }).click();
  await expect(page.getByLabel('Country', { exact: true })).toHaveValue('Thailand');
  await expect(page.locator('.scholarship-card')).toHaveCount(6);
  await page.getByRole('button', { name: 'Clear All Filters' }).click();
  await expect(page.locator('.scholarship-card')).toHaveCount(11);
  await page.getByRole('button', { name: 'See how it works', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next chapter, in three steps.' })).toBeInViewport();
  await mockCognito(page);
  await page.getByRole('button', { name: 'Get started with ScholarRise', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mock Cognito email verification' })).toBeVisible();
  await page.getByRole('link', { name: 'Complete secure sign-in' }).click();
  await expect(page.getByRole('button', { name: 'My workspace' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
