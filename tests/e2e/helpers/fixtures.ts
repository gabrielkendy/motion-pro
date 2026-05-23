/**
 * Custom Playwright fixtures exposing pre-authenticated API clients
 * for a regular user and an admin user. Tokens come from env vars so the
 * harness ships zero secrets. Tests skip themselves cleanly when missing.
 */
import { test as base } from '@playwright/test';
import { Api } from './api';

export interface AuthedFixtures {
  authedUser: Api;
  adminUser: Api;
  userToken: string;
  adminToken: string;
}

export const test = base.extend<AuthedFixtures>({
  userToken: async ({}, use) => {
    const token = process.env.MV_TEST_USER_TOKEN || '';
    await use(token);
  },
  adminToken: async ({}, use) => {
    const token = process.env.MV_TEST_ADMIN_TOKEN || '';
    await use(token);
  },
  authedUser: async ({ userToken }, use) => {
    const client = new Api({ token: userToken });
    await use(client);
  },
  adminUser: async ({ adminToken }, use) => {
    const client = new Api({ token: adminToken });
    await use(client);
  },
});

export const expect = test.expect;

/** Skip current test if env var missing. Returns the value (or '' if skipped). */
export function requireEnv(
  testInfo: { skip: (cond: boolean, reason?: string) => void },
  name: string,
  hint?: string,
): string {
  const v = process.env[name];
  if (!v) {
    testInfo.skip(true, `pending: needs ${name}${hint ? ' (' + hint + ')' : ''}`);
    return '';
  }
  return v;
}
