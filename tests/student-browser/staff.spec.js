import { test, expect } from '@playwright/test';
import { mockCognito } from '../fixtures/cognito.js';

function database() {
  const users = [
    { userId: 'uni', name: 'Fictional University Staff', role: 'university', university: 'Fictional University', active: true, version: 1 },
    { userId: 'rival', name: 'Other University Staff', role: 'university', university: 'Other University', active: true, version: 1 },
    { userId: 'admin', name: 'Fictional Administrator', role: 'admin', active: true, version: 1 },
    { userId: 'student', name: 'Fictional Student', role: 'student', active: true, version: 1 },
  ];
  const draft = ownerId => ({ id: ownerId + '-award', ownerId, name: ownerId === 'uni' ? 'University Award' : 'Rival Award',
    university: users.find(u => u.userId === ownerId).university, country: 'Thailand', studyLevels: ["Master's", 'PhD'], fundingType: 'Fully Funded',
    description: 'Fictional award', amount: 'Tuition', coverage: 'Stipend', field: 'All fields', minGpa: 3,
    deadline: '2099-12-01', published: false, approvalStatus: 'pending', version: 1 });
  return { users, rows: [draft('uni'), draft('rival')], writes: [], fail: false, conflict: false, expired: false };
}
async function login(page, db, sub = 'uni') {
  await mockCognito(page, { sub, role: db.users.find(u => u.userId === sub).role });
  await page.route('http://127.0.0.1:5190/**', async route => {
    const request = route.request(), method = request.method(), path = new URL(request.url()).pathname;
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    const reply = (json, status = 200) => route.fulfill({ headers, json, status });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/scholarships') return reply({ items: db.rows.filter(r => r.published && r.approvalStatus === 'approved'), nextOffset: null });
    const token = request.headers().authorization?.slice(7);
    const uid = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub : null;
    const account = db.users.find(u => u.userId === uid);
    if (!account || db.expired) return reply({ message: 'Denied' }, 401);
    if (path === '/me') return reply(account);
    if (path.startsWith('/admin/') && account.role !== 'admin') return reply({ message: 'Denied' }, 403);
    if (path.startsWith('/university/') && account.role !== 'university') return reply({ message: 'Denied' }, 403);
    if (db.fail) return reply({ message: 'Unavailable' }, 503);
    if (method === 'GET') {
      if (path === '/university/scholarships') return reply({ items: db.rows.filter(r => r.ownerId === uid) });
      if (path === '/admin/scholarships') return reply({ items: db.rows });
      if (path === '/admin/users') return reply({ items: db.users });
      if (path === '/admin/statistics') return reply({ users: 4, scholarships: db.rows.length, published: db.rows.filter(r => r.published).length, pending: db.rows.filter(r => r.approvalStatus === 'pending').length });
      if (path.startsWith('/me/')) return reply({ items: [] });
    }
    const body = request.postDataJSON() || {}, id = path.split('/')[3];
    db.writes.push({ path, body });
    let row = db.rows.find(r => r.id === id);
    if (path === '/university/scholarships' && method === 'POST') {
      row = { ...body, id: 'new-award', ownerId: uid, university: account.university, version: 1, published: false, approvalStatus: 'pending' }; db.rows.push(row); return reply(row, 201);
    }
    if (path.startsWith('/admin/users/')) {
      const user = db.users.find(u => u.userId === id);
      if (user.role === 'admin') return reply({ message: 'Denied' }, 403);
      if (user.version !== body.version) return reply({ message: 'Conflict' }, 409);
      Object.assign(user, { active: body.active, version: user.version + 1 }); return reply(user);
    }
    if (!row) return reply({ message: 'Missing' }, 404);
    if (account.role === 'university' && row.ownerId !== uid) return reply({ message: 'Denied' }, 403);
    if (db.conflict) { db.conflict = false; row.name = 'Changed elsewhere'; row.version++; return reply({ message: 'Conflict' }, 409); }
    if (row.version !== body.version) return reply({ message: 'Conflict' }, 409);
    if (path.endsWith('/moderation')) Object.assign(row, { approvalStatus: body.decision === 'reject' ? 'rejected' : 'approved', published: body.decision === 'approve' });
    else if (path.endsWith('/unpublish')) row.published = false;
    else Object.assign(row, { ...body, published: false, approvalStatus: 'pending' });
    row.version++; return reply(row);
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('link', { name: 'Complete secure sign-in' }).click({ noWaitAfter: true });
  await page.waitForURL(url => url.origin === 'http://127.0.0.1:5176', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'My workspace', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'My workspace', exact: true }).click();
  await expect(page.getByText('Loading staff workspace...', { exact: true })).toHaveCount(0);
}

test('university create/edit persists on server, excludes protected fields and only shows owned listings', async ({ page }) => {
  const db = database(); await login(page, db);
  await expect(page.getByRole('cell', { name: /University Award/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Rival Award/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add scholarship', exact: true }).click();
  await page.getByLabel('Scholarship name').fill('New Fictional Award');
  await page.getByLabel('Destination', { exact: true }).fill('Thailand');
  await page.getByLabel('Award (e.g. Full tuition)').fill('Tuition');
  await page.getByLabel('Description', { exact: true }).fill('Fictional description');
  await page.getByRole('button', { name: 'Save scholarship', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'New Fictional Award' });
  await expect(row).toContainText('Pending approval');
  expect(db.writes[0].body.ownerId).toBeUndefined(); expect(db.writes[0].body.published).toBeUndefined();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Scholarship name').fill('Edited Fictional Award');
  await page.getByRole('button', { name: 'Save scholarship', exact: true }).click();
  await expect(page.getByRole('cell', { name: /Edited Fictional Award/ })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'My workspace' }).click();
  await expect(page.getByRole('cell', { name: /Edited Fictional Award/ })).toBeVisible();
  expect(db.rows.find(r => r.id === 'new-award').version).toBe(2);
  // Simulate a separately approved admin publication, then test owner unpublish.
  const published = db.rows.find(r => r.id === 'new-award');
  Object.assign(published, { published: true, approvalStatus: 'approved', version: 3 });
  await page.reload(); await page.getByRole('button', { name: 'My workspace' }).click();
  const edited = page.getByRole('row').filter({ hasText: 'Edited Fictional Award' });
  await edited.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(edited).toContainText('Unpublished');
  expect(published.published).toBe(false);
});

test('administrator approves/rejects/unpublishes and manages activation without granting roles', async ({ page }) => {
  const db = database(); await login(page, db, 'admin');
  await expect(page.getByRole('button', { name: 'Add scholarship', exact: true })).toBeDisabled();
  const row = page.getByRole('row').filter({ hasText: 'University Award' });
  for (const action of ['Reject', 'Approve and publish', 'Unpublish']) {
    await row.getByRole('button', { name: action, exact: true }).click();
    await page.getByLabel('Moderation note').fill('Fictional review');
    await page.getByRole('button', { name: 'Confirm moderation' }).click();
    await expect(page.getByRole('heading', { name: 'Review scholarship', exact: true })).toHaveCount(0);
  }
  const student = page.getByRole('row').filter({ hasText: 'Fictional Student' });
  await student.getByRole('button', { name: 'Disable', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm account change' }).click();
  await expect(student).toContainText('Disabled');
  expect(db.users.find(u => u.userId === 'student').role).toBe('student');
  await expect(page.getByRole('button', { name: 'Operator managed' })).toBeDisabled();
});

test('staff error retry and version conflict never silently overwrite and expired access clears workspace', async ({ page }) => {
  const db = database(); db.fail = true; await login(page, db);
  await expect(page.getByRole('alert')).toContainText('Retry');
  db.fail = false; await page.getByRole('button', { name: 'Retry staff workspace' }).click();
  const row = page.getByRole('row').filter({ hasText: 'University Award' });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  db.conflict = true;
  await page.getByRole('button', { name: 'Save scholarship', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Another session');
  expect(db.writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  db.expired = true; await page.getByRole('button', { name: 'Retry staff workspace' }).click();
  await expect(page.getByRole('button', { name: 'My workspace', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: /Changed elsewhere/ })).toHaveCount(0);
});

test('logout and staff identity change do not expose the previous university catalog', async ({ page }) => {
  const db = database(); await login(page, db);
  await expect(page.getByRole('cell', { name: /University Award/ })).toBeVisible();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  await login(page, db, 'rival');
  await expect(page.getByRole('cell', { name: /Rival Award/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /University Award/ })).toHaveCount(0);
});

test('student session cannot open staff screens despite adversarial admin group claims', async ({ page }) => {
  const db = database(); await login(page, db, 'student');
  await expect(page.getByRole('button', { name: 'Student profile', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'University dashboard', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Administrator dashboard', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add scholarship', exact: true })).toHaveCount(0);
  expect(db.writes).toHaveLength(0);
});
