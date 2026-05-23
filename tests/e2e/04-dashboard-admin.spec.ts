/**
 * 04 — Admin dashboard SPA
 *
 * The dashboard ships as static HTML/JS. Default served locally via
 *   npx serve dashboard -l 4000
 * MV_DASH_LOCAL_URL overrides (e.g. https://app.motionpro.com.br).
 */
import { test, expect, requireEnv } from './helpers/fixtures';
import * as fs from 'fs';
import * as path from 'path';

const PAGES = [
  { path: '/index.html', name: 'login' },
  { path: '/admin/dashboard.html', name: 'admin-dashboard' },
  { path: '/admin/users.html', name: 'admin-users' },
  { path: '/admin/devices.html', name: 'admin-devices' },
  { path: '/admin/audit.html', name: 'admin-audit' },
  { path: '/admin/keys.html', name: 'admin-keys' },
];

test.describe('Dashboard · admin SPA', () => {
  test('stub: dashboard SPA loads from local serve', async ({ page }, testInfo) => {
    const base = process.env.MV_DASH_LOCAL_URL;
    if (!base) {
      testInfo.skip(true, 'pending: needs MV_DASH_LOCAL_URL (e.g. http://localhost:4000)');
      return;
    }
    for (const p of PAGES) {
      const resp = await page.goto(base.replace(/\/$/, '') + p.path, { waitUntil: 'domcontentloaded' });
      expect(resp, `no response for ${p.path}`).toBeTruthy();
      expect([200, 304], `bad status for ${p.path}`).toContain(resp!.status());
      const html = await page.content();
      expect(html.length, `empty html for ${p.path}`).toBeGreaterThan(200);
    }
  });

  test('screenshot all admin pages to screenshots/', async ({ page }, testInfo) => {
    requireEnv(testInfo, 'MV_TEST_ADMIN_TOKEN', 'admin JWT for authed dashboard screens');
    if (testInfo.status === 'skipped') return;
    const base = process.env.MV_DASH_LOCAL_URL;
    if (!base) {
      testInfo.skip(true, 'pending: needs MV_DASH_LOCAL_URL');
      return;
    }
    const token = process.env.MV_TEST_ADMIN_TOKEN!;
    const outDir = path.join(__dirname, 'screenshots');
    fs.mkdirSync(outDir, { recursive: true });

    await page.addInitScript((t) => {
      try { localStorage.setItem('mv_token', t); localStorage.setItem('token', t); } catch (_) {}
    }, token);

    for (const p of PAGES) {
      await page.goto(base.replace(/\/$/, '') + p.path, { waitUntil: 'networkidle' });
      await page.screenshot({ path: path.join(outDir, `${p.name}.png`), fullPage: true });
    }
  });

  test('extend-trial non-destructive action on test user', async ({ adminUser }, testInfo) => {
    requireEnv(testInfo, 'MV_TEST_ADMIN_TOKEN', 'admin JWT to call /v1/admin/users/:id/extend-trial');
    if (testInfo.status === 'skipped') return;
    const targetId = process.env.MV_TEST_TARGET_USER_ID;
    if (!targetId) {
      testInfo.skip(true, 'pending: needs MV_TEST_TARGET_USER_ID (test account UUID)');
      return;
    }
    const r = await adminUser.post(`/v1/admin/users/${targetId}/extend-trial`, { days: 1 });
    expect([200, 204]).toContain(r.status);
  });
});
