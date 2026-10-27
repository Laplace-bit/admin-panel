import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { LIVE, MOCK_FIXTURES_SKIP_REASON } from './live';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function uniqueName(prefix: string) {
  return `${prefix} ${Date.now()}`;
}

async function hideTanStackDevtools(page: Page) {
  await page.evaluate(() => {
    document
      .querySelector<HTMLElement>('button[aria-label="Open TanStack Devtools"]')
      ?.style.setProperty('display', 'none');
  });
}

/** The tab's search field: click-ui's SearchField renders a textbox, not a searchbox. */
const searchField = (page: Page) => page.getByRole('textbox', { name: /^search/i });

/** Deletes a role or group with its row's Delete button, so a live run leaves none behind. */
async function deleteFromList(page: Page, tab: 'roles' | 'groups', name: string) {
  await page.goto(`/access?tab=${tab}`);
  await searchField(page).fill(name);
  await page.getByRole('button', { name: `Delete ${name}` }).click();
  const confirmDialog = page.getByRole('dialog');
  await confirmDialog.getByRole('button', { name: /delete/i }).click();
  await expect(confirmDialog).not.toBeVisible({ timeout: 5000 });
}

/** Creates a group with the Create Group dialog, as a live run stages the groups a test lists. */
async function createGroup(page: Page, name: string) {
  await page.goto('/access?tab=groups');
  await page.getByRole('button', { name: /create group/i }).click();
  const dialog = page.getByRole('dialog');
  await page.locator('#create-group-name').fill(name);
  await dialog.getByRole('button', { name: /create group/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

/**
 * `groups` names the Engineering and Marketing groups a test lists. The mock
 * serves them as fixtures; against a live LibreChat the test creates them under
 * unique names first and deletes them afterwards. Staging reloads the page at
 * the end so its "created" toasts are gone, as on a fresh load from the mock.
 */
const test = base.extend<{ groups: { engineering: string; marketing: string } }>({
  groups: async ({ page }, use) => {
    if (!LIVE) {
      await use({ engineering: 'Engineering', marketing: 'Marketing' });
      return;
    }
    const staged = { engineering: uniqueName('Engineering'), marketing: uniqueName('Marketing') };
    await createGroup(page, staged.engineering);
    await createGroup(page, staged.marketing);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await use(staged);
    await deleteFromList(page, 'groups', staged.engineering);
    await deleteFromList(page, 'groups', staged.marketing);
  },
});

test.describe('Access page accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/access');
    await page.waitForLoadState('networkidle');
  });

  test('has zero WCAG 2.1 AA violations on Groups tab', async ({ page, groups }) => {
    await page.getByRole('tab', { name: /groups/i }).click();
    await expect(page.getByText(groups.engineering, { exact: true })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    expect(results.violations).toEqual([]);
  });

  test('has zero WCAG 2.1 AA violations on Roles tab', async ({ page }) => {
    await expect(page.getByText('ADMIN', { exact: true })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe('Access page tabs', () => {
  test('defaults to Roles tab', async ({ page }) => {
    await page.goto('/access');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('USER', { exact: true })).toBeVisible();
  });

  test('switches to Groups tab and updates URL', async ({ page, groups }) => {
    await page.goto('/access');
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /groups/i }).click();

    await expect(page.getByText(groups.engineering, { exact: true })).toBeVisible();
    expect(page.url()).toContain('tab=groups');
  });

  test('respects ?tab=roles in URL', async ({ page }) => {
    await page.goto('/access?tab=roles');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('ADMIN', { exact: true })).toBeVisible();
    await expect(page.getByText('USER', { exact: true })).toBeVisible();
  });

  test('switches back to Groups from Roles', async ({ page, groups }) => {
    await page.goto('/access?tab=roles');
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /groups/i }).click();

    await expect(page.getByText(groups.engineering, { exact: true })).toBeVisible();
    expect(page.url()).toContain('tab=groups');
  });
});

test.describe('Access page search', () => {
  test('filters groups by name', async ({ page, groups }) => {
    await page.goto('/access?tab=groups');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(groups.engineering, { exact: true })).toBeVisible();

    await searchField(page).fill('marketing');

    await expect(page.getByText(groups.marketing, { exact: true })).toBeVisible();
    await expect(page.getByText(groups.engineering, { exact: true })).not.toBeVisible();
  });

  test('filters roles by name', async ({ page }) => {
    await page.goto('/access?tab=roles');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('ADMIN', { exact: true })).toBeVisible();

    await searchField(page).fill('user');

    await expect(page.getByText('USER', { exact: true })).toBeVisible();
    await expect(page.getByText('ADMIN', { exact: true })).not.toBeVisible();
  });

  test('shows empty state when no groups match', async ({ page }) => {
    await page.goto('/access?tab=groups');
    await page.waitForLoadState('networkidle');

    await searchField(page).fill('zzzznonexistent');

    await expect(page.getByText(/no groups found/i)).toBeVisible();
  });
});

test.describe('Access page Create Group dialog', () => {
  let created: string | undefined;

  test.afterEach(async ({ page }) => {
    if (!created) return;
    await deleteFromList(page, 'groups', created);
    created = undefined;
  });

  test('creates a new group and shows it in the list', async ({ page }) => {
    const name = uniqueName('E2E Group');
    await page.goto('/access?tab=groups');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /create group/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.locator('#create-group-name').fill(name);
    await page.locator('#create-group-description').fill('Created by e2e test');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /create group/i })
      .click();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
    created = name;
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('Create Group button is disabled when name is empty', async ({ page }) => {
    await page.goto('/access?tab=groups');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /create group/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const createBtn = page.getByRole('dialog').getByRole('button', { name: /create group/i });
    await expect(createBtn).toBeDisabled();
  });
});

test.describe('Access page Create Role dialog', () => {
  let created: string | undefined;

  test.afterEach(async ({ page }) => {
    if (!created) return;
    await deleteFromList(page, 'roles', created);
    created = undefined;
  });

  test('creates a new role and shows it in the list', async ({ page }) => {
    const name = uniqueName('E2E Role');
    await page.goto('/access?tab=roles');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /create role/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.locator('#create-role-name').fill(name);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /create role/i })
      .click();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
    created = name;
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Access page Members dialog', () => {
  test.skip(LIVE, MOCK_FIXTURES_SKIP_REASON);

  test('opens members dialog by clicking a group name', async ({ page }) => {
    await page.goto('/access?tab=groups');
    await page.waitForLoadState('networkidle');

    await page.getByText('Engineering', { exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('tab', { name: 'Members' }).click();
    await expect(page.getByText('Alice Chen')).toBeVisible();
    await expect(page.getByText('Bob Martinez')).toBeVisible();
  });

  test('opens members dialog from the keyboard', async ({ page }) => {
    await page.goto('/access?tab=groups');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /^engineering/i }).focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByRole('tab', { name: 'Members' })).toBeVisible();
  });

  test('shows member count', async ({ page }) => {
    await page.goto('/access?tab=groups');
    await page.waitForLoadState('networkidle');

    await page.getByText('Engineering', { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('tab', { name: 'Members' }).click();

    await expect(page.getByText(/4 members/i)).toBeVisible();
  });
});

test.describe('Access page system role protection', () => {
  test('system roles show System badge', async ({ page }) => {
    await page.goto('/access?tab=roles');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('System').first()).toBeVisible();
  });

  test('system role has no delete button but still opens its members', async ({ page }) => {
    await page.goto('/access?tab=roles');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: /create role/i })).toBeEnabled();
    await expect(page.getByText('ADMIN', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete ADMIN' })).toHaveCount(0);

    await page.getByText('ADMIN', { exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByRole('tab', { name: 'Members' })).toBeVisible();
  });
});

test.describe('Access page delete', () => {
  let created: string | undefined;

  test.afterEach(async ({ page }) => {
    if (!created) return;
    await deleteFromList(page, 'roles', created);
    created = undefined;
  });

  test('deletes a non-system role with its Delete button', async ({ page }) => {
    const name = uniqueName('Deletable Role');
    await page.goto('/access?tab=roles');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /create role/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.locator('#create-role-name').fill(name);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /create role/i })
      .click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
    created = name;
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 });

    // TanStack Devtools' toggle can cover the row's Delete button
    await hideTanStackDevtools(page);
    await page.getByRole('button', { name: `Delete ${name}` }).click();

    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog.getByText(/are you sure/i)).toBeVisible();
    await confirmDialog.getByRole('button', { name: /delete/i }).click();

    await expect(confirmDialog).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText(name, { exact: true })).not.toBeVisible({ timeout: 5000 });
    created = undefined;
  });
});
