import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Configuration specs need a LibreChat backend that serves the admin config
 * API; the default mock backend does not. Run them against a live stack with
 * `E2E_LIVE=1 E2E_BASE_URL=http://localhost:4386 npx playwright test`.
 */
export const LIVE = process.env.E2E_LIVE === '1';
export const LIVE_SKIP_REASON =
  'Needs a live LibreChat backend: set E2E_LIVE=1 and E2E_BASE_URL to a running admin panel';

/**
 * Some access and grants tests read fixtures only the mock backend serves: the
 * Engineering group's members, five or more roles and the grant history. A
 * fresh LibreChat seeds only the ADMIN and USER roles and none of the rest,
 * and its admin API can neither create users nor delete audit entries, so a
 * live run cannot stage the members or the history without leaving data
 * behind. Those tests run against the mock only.
 */
export const MOCK_FIXTURES_SKIP_REASON =
  "Reads e2e/mock-backend.mjs's fixtures, which a live LibreChat does not have";

export const CONFIG_TABS = [
  'providers',
  'custom',
  'specs',
  'mcp',
  'features',
  'files',
  'system',
] as const;

/** Opens a configuration tab and waits until its form has rendered real fields. */
export async function openConfigTab(page: Page, tab: string) {
  await page.goto(`/configuration?tab=${tab}`);
  const form = page.getByRole('form', { name: 'Configuration' });
  await expect(form).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}
