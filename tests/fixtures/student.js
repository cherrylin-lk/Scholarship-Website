import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockCognito } from './cognito.js';

const catalog = JSON.parse(readFileSync(new URL('../../backend/fixtures/scholarships.json', import.meta.url), 'utf8'));
export function database() {
  const users = new Map(), saved = new Map(), apps = new Map(), writes = [];
  for (const sub of ['oidc-student-sub', 'other-student-sub']) {
    users.set(sub, { userId: sub, name: 'Remote Student', role: 'student', active: true, version: 1,
      profile: { degree: "Bachelor's", gpa: 3.3, field: 'All fields', country: '', bio: '', fullFunding: false, reminders: true, reminderDays: 14 } });
    saved.set(sub, new Map()); apps.set(sub, new Map());
  }
  return { users, saved, apps, writes, missing: false, reject: 0, conflict: '', failRead: false };
}
async function routes(page, db) {
  await page.route('http://127.0.0.1:5190/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type',
      'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS' };
    const reply = (json, status = 200) => route.fulfill({ status, headers, json });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/scholarships') return reply({ items: catalog, total: catalog.length, nextOffset: null });
    const token = request.headers().authorization?.slice(7);
    const sub = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub : null;
    if (!sub || !db.users.has(sub)) return reply({ message: 'Denied' }, 401);
    if (db.missing) return reply({ message: 'Account not provisioned' }, 403);
    if (db.reject) return reply({ message: 'Denied' }, db.reject);
    if (db.failRead && path === '/me/saved') return reply({ message: 'Offline' }, 503);
    const account = db.users.get(sub), saved = db.saved.get(sub), apps = db.apps.get(sub);
    if (method === 'GET') {
      if (path === '/me') return reply(account);
      if (path === '/me/saved') return reply({ items: [...saved.values()] });
      if (path === '/me/applications') return reply({ items: [...apps.values()] });
    }
    const body = method === 'PUT' ? request.postDataJSON() : {};
    db.writes.push({ sub, path, method, body });
    if (path === '/me/profile' && method === 'PUT') {
      if (db.conflict === 'profile') { db.conflict = ''; account.name = 'Changed elsewhere'; account.version++; return reply({ message: 'Conflict' }, 409); }
      if (body.version !== account.version) return reply({ message: 'Conflict' }, 409);
      const { name, version, ...profile } = body;
      const next = { ...account, name, profile, version: version + 1 }; db.users.set(sub, next); return reply(next);
    }
    const id = decodeURIComponent(path.split('/').at(-1));
    if (path.startsWith('/me/saved/')) {
      if (method === 'DELETE') { saved.delete(id); return reply({ deleted: true }); }
      const record = { userId: sub, scholarshipId: id, recordKey: `SAVED#${id}`, version: 1 }; saved.set(id, record); return reply(record);
    }
    if (path.startsWith('/me/applications/')) {
      if (method === 'DELETE') { apps.delete(id); return reply({ deleted: true }); }
      const old = apps.get(id);
      if (db.conflict === 'application') {
        db.conflict = ''; apps.set(id, { ...old, status: 'Submitted', notes: 'Other session note', version: old.version + 1 });
        return reply({ message: 'Conflict' }, 409);
      }
      if (old && body.version !== old.version) return reply({ message: 'Conflict' }, 409);
      const record = { ...body, userId: sub, scholarshipId: id, recordKey: `APPLICATION#${id}`, updatedAt: new Date().toISOString(), version: (old?.version || 0) + 1 };
      apps.set(id, record); return reply(record);
    }
    return reply({ message: 'Not found' }, 404);
  });
}
export async function login(page, db, sub = 'oidc-student-sub', wait = true) {
  const provider = await mockCognito(page, { sub });
  await routes(page, db);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('link', { name: 'Complete secure sign-in' }).click({ noWaitAfter: true });
  if (wait) { await expect(page.getByRole('button', { name: 'My workspace', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Unsave|Save) Sample Japan Graduate Award$/ })).toBeEnabled(); }
  return provider;
}
export async function openProfile(page) {
  await page.getByRole('button', { name: 'My workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Student profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeEnabled();
}
export async function trackJapan(page, db) {
  await page.getByLabel('Country', { exact: true }).selectOption('Japan');
  await page.getByRole('button', { name: 'View details' }).click();
  await page.getByRole('button', { name: 'Track application', exact: true }).click();
  await expect.poll(() => db.apps.get('oidc-student-sub').size).toBe(1);
  await page.getByRole('button', { name: 'My workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Application tracking', exact: true }).click();
}
