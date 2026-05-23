/**
 * 02 — Stripe Checkout (Legendas mensal R$ 59,90)
 *
 * Stub  : verifies backend /health is reachable; optionally checks the
 *         landing /legendas/ page when MV_LANDING_URL is provided.
 * Full  : drives Stripe Checkout with test card 4242 4242 4242 4242.
 *         Requires STRIPE_SECRET_TEST plus test prices wired in backend.
 * Sync  : polls /v1/me/products to confirm webhook unlocked "legendas".
 */
import { chromium } from '@playwright/test';
import { test, expect, requireEnv } from './helpers/fixtures';
import { Api } from './helpers/api';

test.describe('Stripe · Checkout legendas mensal', () => {
  test('stub: pricing page loads', async () => {
    // Backend (motionpro.vercel.app) exposes the API only; landing pages live
    // on the marketing domain (set MV_LANDING_URL to enable that check).
    // We always verify the backend itself is up via /health, then optionally
    // probe the landing /legendas/ when MV_LANDING_URL is provided.
    const api = new Api();
    const health = await api.get('/health');
    expect(health.status).toBe(200);
    expect((health.body as any).ok).toBe(true);

    const landingBase = process.env.MV_LANDING_URL;
    if (landingBase) {
      const landing = new Api({ baseURL: landingBase });
      const res = await landing.get('/legendas/');
      expect([200, 301, 302]).toContain(res.status);
      if (res.status === 200) expect(res.raw).toMatch(/<h1[\s>]/i);
    }
  });

  test('full: checkout legendas mensal R$59,90', async ({}, testInfo) => {
    requireEnv(testInfo, 'STRIPE_SECRET_TEST', 'sk_test_… to drive Checkout in test mode');
    if (testInfo.status === 'skipped') return;

    const api = new Api();
    const create = await api.post('/v1/billing/checkout', { product: 'legendas', plan: 'monthly' });
    expect(create.status).toBe(200);
    const url = (create.body as any).url;
    expect(url).toMatch(/checkout\.stripe\.com/);

    const browser = await chromium.launch({ headless: !!process.env.CI });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(url);

    await page.getByLabel(/card number/i).fill('4242 4242 4242 4242');
    await page.getByLabel(/expiration|expiry/i).fill('12 / 30');
    await page.getByLabel(/cvc/i).fill('123');
    const name = page.getByLabel(/name on card|cardholder/i);
    if (await name.count()) await name.fill('E2E Test');
    const postal = page.getByLabel(/postal|zip|cep/i);
    if (await postal.count()) await postal.fill('01234-567');

    await page.getByRole('button', { name: /pay|subscribe|pagar|assinar/i }).click();
    await page.waitForURL(/success\.html/, { timeout: 60_000 });
    expect(page.url()).toContain('success.html');
    await browser.close();
  });

  test('webhook updated /v1/me/products', async ({ authedUser }, testInfo) => {
    requireEnv(testInfo, 'MV_TEST_USER_TOKEN', 'user JWT to read /v1/me/products');
    if (testInfo.status === 'skipped') return;
    const deadline = Date.now() + 10_000;
    let saw = false;
    while (Date.now() < deadline) {
      const r = await authedUser.get('/v1/me/products');
      if (r.status === 200) {
        const items = (r.body as any)?.products || (r.body as any) || [];
        if (Array.isArray(items) && items.some((p: any) => (p.product_id || p.id || p) === 'legendas')) {
          saw = true; break;
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(saw).toBeTruthy();
  });
});
