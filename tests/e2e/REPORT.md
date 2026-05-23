# Motion Pro · e2e Test Harness Report

Agent: iota · Sprint MEGA · Motion Suite Close v2.0
Branch: iota/e2e-playwright
Backend: https://motionpro.vercel.app
Playwright: 1.58.1
Run mode: STUB (no real Stripe/Google creds wired yet)

## Test matrix

| # | Spec | Test | Stub status | Env needed for FULL |
|---|------|------|-------------|----------------------|
| 1 | 01-oauth-google.spec.ts | stub: oauth start returns 302 to accounts.google.com (or 503) | PASS | - |
| 2 | 01-oauth-google.spec.ts | full: callback returns JWT in #token= | PENDING-CREDS | GOOGLE_TEST_ENABLED=1 + headed |
| 3 | 01-oauth-google.spec.ts | audit log shows oauth_login entry | PENDING-CREDS | MV_TEST_ADMIN_TOKEN |
| 4 | 02-stripe-checkout.spec.ts | stub: pricing page loads (/health + optional landing) | PASS | MV_LANDING_URL (optional) |
| 5 | 02-stripe-checkout.spec.ts | full: checkout legendas mensal R$59,90 | PENDING-CREDS | STRIPE_SECRET_TEST |
| 6 | 02-stripe-checkout.spec.ts | webhook updated /v1/me/products | PENDING-CREDS | MV_TEST_USER_TOKEN |
| 7 | 03-trial-new-user.spec.ts | signup + trial issue + cleanup | PENDING-CREDS | MV_TEST_SIGNUP_ENABLED=1 |
| 8 | 04-dashboard-admin.spec.ts | stub: dashboard SPA loads from local serve | PENDING-CREDS | MV_DASH_LOCAL_URL |
| 9 | 04-dashboard-admin.spec.ts | screenshot all admin pages to screenshots/ | PENDING-CREDS | MV_TEST_ADMIN_TOKEN + MV_DASH_LOCAL_URL |
|10 | 04-dashboard-admin.spec.ts | extend-trial non-destructive action on test user | PENDING-CREDS | MV_TEST_ADMIN_TOKEN + MV_TEST_TARGET_USER_ID |

Stub run: 2 passed, 8 skipped (explicit "pending: needs ..." reasons), 0 failed. Total ~1.2s.

## Env vars

| Var | Purpose |
|-----|---------|
| MV_BASE_URL | backend base URL (default https://motionpro.vercel.app) |
| MV_LANDING_URL | marketing/landing base (when set, stub probes /legendas/) |
| MV_TEST_USER_TOKEN | JWT of existing test user (feeds authedUser fixture) |
| MV_TEST_ADMIN_TOKEN | JWT of admin user (feeds adminUser fixture + audit) |
| MV_TEST_TARGET_USER_ID | UUID of disposable test account for extend-trial |
| MV_TEST_SIGNUP_ENABLED | "1" to allow signup-flow test |
| MV_DASH_LOCAL_URL | local dashboard URL (e.g. http://localhost:4000) |
| STRIPE_SECRET_TEST | sk_test_... key required for Checkout full mode |
| GOOGLE_TEST_ENABLED | "1" to opt into headed Google OAuth |

Test card (Stripe test mode): 4242 4242 4242 4242 - CVC 123 - exp 12/30 - CEP 01234-567.
Test email convention: e2e-*@pacotesfx-test.com (non-deliverable suffix).

## How to run

cd tests/e2e
npm install --prefix . --no-audit --no-fund
npx playwright install chromium

# Stub mode (no creds):
npm run e2e
# Headed:
npm run e2e:headed
# HTML report:
npm run e2e:report

## Stub-run output (verbatim)

Running 10 tests using 1 worker

  ok  1 [chromium] > 01-oauth-google.spec.ts > stub: oauth start endpoint returns 302 ... (226ms)
  -   2 [chromium] > 01-oauth-google.spec.ts > full: callback returns JWT in #token=
  -   3 [chromium] > 01-oauth-google.spec.ts > audit log shows oauth_login entry
  ok  4 [chromium] > 02-stripe-checkout.spec.ts > stub: pricing page loads (156ms)
  -   5 [chromium] > 02-stripe-checkout.spec.ts > full: checkout legendas mensal R$59,90
  -   6 [chromium] > 02-stripe-checkout.spec.ts > webhook updated /v1/me/products
  -   7 [chromium] > 03-trial-new-user.spec.ts > signup + trial issue + cleanup
  -   8 [chromium] > 04-dashboard-admin.spec.ts > stub: dashboard SPA loads from local serve
  -   9 [chromium] > 04-dashboard-admin.spec.ts > screenshot all admin pages to screenshots/
  -  10 [chromium] > 04-dashboard-admin.spec.ts > extend-trial non-destructive action on test user

  8 skipped
  2 passed (1.2s)

HTML report at playwright-report/index.html (gitignored). Open with: npm run e2e:report

## Notes

- .gitignore excludes node_modules/, test-results/, playwright-report/, .auth/
- .auth/google-state.json is created by OAuth full test on first headed run (gitignored)
- workers=1 + retries=1 to stay inside Vercel free-tier rate limits
- chromium only project
- No backend or plugin code was touched; only files under tests/e2e/ were written
