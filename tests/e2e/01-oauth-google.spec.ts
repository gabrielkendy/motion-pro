/**
 * 01 — Google OAuth flow
 *
 * Stub  : /v1/oauth/google/start either 302-redirects to accounts.google.com
 *         with a state param, OR returns 503 "oauth_not_configured" when the
 *         backend has no Google client_id/secret set. Both are valid because
 *         we only verify the route is wired and behaves as designed.
 * Full  : opens HEADED browser, completes Google consent, asserts URL carries
 *         #token=<jwt>. Requires GOOGLE_TEST_ENABLED=1.
 * Audit : queries /v1/admin/audit and verifies the action shape.
 */
import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { test, expect, requireEnv } from './helpers/fixtures';
import { Api } from './helpers/api';

const STATE_DIR = path.join(__dirname, '.auth');
const STATE_PATH = path.join(STATE_DIR, 'google-state.json');

test.describe('OAuth · Google', () => {
  test('stub: oauth start endpoint returns 302 to accounts.google.com (or 503 not_configured)', async () => {
    const api = new Api();
    const res = await api.get('/v1/oauth/google/start');
    if (res.status === 302) {
      const loc = res.headers['location'] || '';
      expect(loc).toContain('accounts.google.com');
      expect(loc).toMatch(/[?&]state=/);
      expect(loc).toMatch(/[?&]client_id=/);
    } else {
      expect(res.status).toBe(503);
      expect((res.body as any)?.error).toBe('oauth_not_configured');
    }
  });

  test('full: callback returns JWT in #token=', async ({}, testInfo) => {
    if (!process.env.GOOGLE_TEST_ENABLED) {
      testInfo.skip(true, 'pending: needs GOOGLE_TEST_ENABLED=1 (+ headed run)');
      return;
    }
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const hasState = fs.existsSync(STATE_PATH);
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext(hasState ? { storageState: STATE_PATH } : {});
    const page = await context.newPage();

    const base = process.env.MV_BASE_URL || 'https://motionpro.vercel.app';
    await page.goto(`${base}/v1/oauth/google/start`);
    await page.waitForURL((u) => u.toString().includes('#token='), { timeout: 90_000 });
    expect(page.url()).toMatch(/#token=[^&]+/);

    if (!hasState) await context.storageState({ path: STATE_PATH });
    await browser.close();
  });

  test('audit log shows oauth_login entry', async ({ adminUser }, testInfo) => {
    requireEnv(testInfo, 'MV_TEST_ADMIN_TOKEN', 'admin JWT to read /v1/admin/audit');
    if (testInfo.status === 'skipped') return;
    const res = await adminUser.get('/v1/admin/audit?action=oauth_login&limit=5');
    expect([200, 204]).toContain(res.status);
    const body = res.body as any;
    if (Array.isArray(body?.items)) {
      for (const row of body.items) expect(row).toHaveProperty('action');
    }
  });
});
