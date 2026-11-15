import { test, expect } from '@playwright/test';

test('React reads public Lambda-compatible API data through its service layer', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('API discovery preview.', { exact: false })).toBeVisible();
  await expect(page.locator('.scholarship-card')).toHaveCount(2);
  await page.getByLabel('Country', { exact: true }).selectOption('Japan');
  await page.getByLabel('Filter study level', { exact: true }).selectOption("Master's");
  await page.getByLabel('Funding', { exact: true }).selectOption('Fully Funded');
  await expect(page.locator('.scholarship-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'View details' }).click();
  await expect(page.getByRole('dialog')).toContainText('Sample Japan Graduate Award');
  await expect(page.getByRole('button', { name: 'Track application', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByLabel('Country', { exact: true })).toHaveValue('Japan');
  expect(errors).toEqual([]);
});

test('offline Python API enforces roles, ownership, approval and student privacy', async ({ request }) => {
  const base = 'http://127.0.0.1:8000';
  const headers = role => ({ Authorization: `Bearer local-${role}` });
  expect((await request.get(`${base}/admin/users`, { headers: headers('student') })).status()).toBe(403);
  expect((await request.get(`${base}/me`)).status()).toBe(401);
  const created = await request.post(`${base}/university/scholarships`, { headers: headers('university'), data: {
    name: 'API Pending Award', country: 'Thailand', studyLevels: ["Master's", 'PhD'], fundingType: 'Tuition Waiver',
    amount: 'Sample tuition', description: 'Synthetic approval workflow fixture', deadline: '2099-12-31', minGpa: 3,
  } });
  expect(created.status()).toBe(201);
  const award = await created.json();
  expect((await request.get(`${base}/scholarships/${award.id}`)).status()).toBe(404);
  const moderation = await request.post(`${base}/admin/scholarships/${award.id}/moderation`, { headers: headers('admin'), data: { decision: 'approve', version: award.version } });
  expect(moderation.status()).toBe(200);
  expect((await request.get(`${base}/scholarships/${award.id}`)).status()).toBe(200);
  expect((await request.put(`${base}/me/applications/${award.id}`, { headers: headers('student'), data: { status: 'Preparing', notes: 'Synthetic private note' } })).status()).toBe(200);
  expect((await request.get(`${base}/me/applications`, { headers: headers('university') })).status()).toBe(403);
  expect((await request.put(`${base}/me/saved/${award.id}`, { headers: headers('student') })).status()).toBe(200);
  const saved = await (await request.get(`${base}/me/saved`, { headers: headers('student') })).json();
  expect(saved.items.some(s => s.scholarshipId === award.id)).toBe(true);
  // Clean up test-visible publication without deleting history.
  const latest = await moderation.json();
  expect((await request.post(`${base}/admin/scholarships/${award.id}/moderation`, { headers: headers('admin'), data: { decision: 'unpublish', version: latest.version } })).status()).toBe(200);
});
