/**
 * 03 — Trial issue flow for a brand-new user
 *
 * Gated by MV_TEST_SIGNUP_ENABLED to avoid creating accounts on production
 * during routine stub runs. Cleanup is best-effort via DELETE /v1/me.
 *
 * Test emails use the @pacotesfx-test.com suffix — NOT a real deliverable
 * domain — so welcome emails bounce harmlessly.
 */
import { test, expect } from './helpers/fixtures';
import { Api } from './helpers/api';

test.describe('Trial · new user signup', () => {
  test('signup + trial issue + cleanup', async ({}, testInfo) => {
    if (!process.env.MV_TEST_SIGNUP_ENABLED) {
      testInfo.skip(true, 'pending: needs MV_TEST_SIGNUP_ENABLED=1 (creates a real account)');
      return;
    }

    const email = `e2e-trial-${Date.now()}@pacotesfx-test.com`;
    const password = `E2E!${Date.now()}aB`;
    const api = new Api();

    const signup = await api.post('/v1/auth/signup', { email, password });
    expect([200, 201]).toContain(signup.status);

    const login = await api.post('/v1/auth/login', { email, password });
    expect(login.status).toBe(200);
    const token = (login.body as any).token || (login.body as any).access_token;
    expect(token).toBeTruthy();

    const authed = api.withToken(token);
    const issue = await authed.post('/v1/license/issue', {
      product_id: 'legendas',
      fingerprint: 'e2e-fp-test',
    });
    expect([200, 201]).toContain(issue.status);
    const body = issue.body as any;
    expect(body.status === 'trialing' || body.plan === 'trial' || body.trial === true).toBeTruthy();

    const del = await authed.del('/v1/me');
    expect([200, 202, 204, 404]).toContain(del.status);
  });
});
