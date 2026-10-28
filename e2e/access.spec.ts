import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import {
  createGroup,
  createRole,
  deleteFromList,
  grantReadUsage,
  grantsRow,
  isListed,
  renameRole,
  searchField,
  uniqueName,
} from './access';
import { AUDITED_WRITES_SKIP_REASON, LIVE, MOCK_FIXTURES_SKIP_REASON } from './live';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function hideTanStackDevtools(page: Page) {
  await page.evaluate(() => {
    document
      .querySelector<HTMLElement>('button[aria-label="Open TanStack Devtools"]')
      ?.style.setProperty('display', 'none');
  });
}

interface StagedGroups {
  engineering: string;
  marketing: string;
}

/**
 * When a worker fixture runs out of time, Playwright fails the test and closes
 * the browser under the step that stalled, so the fixture's `finally` could no
 * longer delete anything. Each staging and cleanup step therefore fails after
 * STAGING_STEP_TIMEOUT, well inside STAGING_TIMEOUT, while the browser is open.
 */
const STAGING_STEP_TIMEOUT = 10_000;
const STAGING_TIMEOUT = 60_000;

/**
 * Opens a page in a context of its own whose actions and page loads each fail
 * after STAGING_STEP_TIMEOUT. The timeout is set on the page: Playwright gives
 * a new context the config's navigationTimeout, which is unset here (no limit)
 * and outranks a context-wide default.
 */
async function openStagingPage(browser: Browser, options: BrowserContextOptions) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.setDefaultTimeout(STAGING_STEP_TIMEOUT);
  return page;
}

/**
 * `groups` names the Engineering and Marketing groups a test lists. The mock
 * serves them as fixtures. A fresh LibreChat has none, so against a live one
 * the worker creates them under unique names and deletes them when it ends.
 * Staging uses a page of its own, so its "created" toasts never reach a test's
 * page. Each name is tracked before its group is created, and every tracked
 * group still listed is deleted even when staging fails or stalls part-way.
 * Cleanup closes the staging context and starts a fresh one, so it works
 * whatever state staging left its page in.
 */
const test = base.extend<object, { groups: StagedGroups }>({
  groups: [
    async ({ browser }, use, workerInfo) => {
      if (!LIVE) {
        await use({ engineering: 'Engineering', marketing: 'Marketing' });
        return;
      }
      const { baseURL, storageState } = workerInfo.project.use;
      const contextOptions: BrowserContextOptions = { baseURL, storageState };
      const staging = await openStagingPage(browser, contextOptions);
      const staged: StagedGroups = {
        engineering: uniqueName('Engineering'),
        marketing: uniqueName('Marketing'),
      };
      const tracked: string[] = [];
      try {
        for (const name of Object.values(staged)) {
          tracked.push(name);
          await createGroup(staging, name);
        }
        await use(staged);
      } finally {
        await staging.context().close();
        const fresh = await openStagingPage(browser, contextOptions);
        await deleteFromList(fresh, 'groups', ...tracked).finally(() => fresh.context().close());
      }
    },
    { scope: 'worker', timeout: STAGING_TIMEOUT },
  ],
});

/**
 * LibreChat audits every group write, so live the file runs in order in one
 * worker and the worker-scoped `groups` are staged once per run, not once per
 * worker that runs a Groups-tab test.
 */
if (LIVE) test.describe.configure({ mode: 'default' });

/** The Groups tab's own search field, which a switch from the Roles tab has to wait for. */
const groupSearchField = (page: Page) => page.getByRole('textbox', { name: /^search groups/i });

/**
 * Searches the Groups tab for the group's full name and waits until it is
 * listed: the tab shows 50 groups a page, sorted by name, so on a live
 * LibreChat with more groups a staged group may not be on the first page.
 */
async function findGroup(page: Page, name: string) {
  await groupSearchField(page).fill(name);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

test.describe('Access page accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/access');
    await page.waitForLoadState('networkidle');
  });

  test('has zero WCAG 2.1 AA violations on Groups tab', async ({ page, groups }) => {
    await page.getByRole('tab', { name: /groups/i }).click();
    await findGroup(page, groups.engineering);

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

    await findGroup(page, groups.engineering);
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

    await findGroup(page, groups.engineering);
    expect(page.url()).toContain('tab=groups');
  });
});

test.describe('Access page search', () => {
  test('filters groups by name', async ({ page, groups }) => {
    await page.goto('/access?tab=groups');
    await page.waitForLoadState('networkidle');
    await findGroup(page, groups.engineering);

    await groupSearchField(page).fill(groups.marketing.toLowerCase());

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
    test.skip(LIVE, AUDITED_WRITES_SKIP_REASON);
    const name = uniqueName('E2E Group');
    await page.goto('/access?tab=groups');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /create group/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.locator('#create-group-name').fill(name);
    await page.locator('#create-group-description').fill('Created by e2e test');
    created = name;
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /create group/i })
      .click();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
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
  test.skip(LIVE, AUDITED_WRITES_SKIP_REASON);
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
    created = name;
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /create role/i })
      .click();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
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
  test.skip(LIVE, AUDITED_WRITES_SKIP_REASON);
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
    created = name;
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /create role/i })
      .click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
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

/**
 * LibreChat keys system grants by role name and its role rename (`renameRole`
 * in `packages/api/src/admin/roles.ts`) moves only the role's users, so the
 * grants stay under the old name: the renamed role holds none until a role
 * takes the old name again.
 */
test.describe('Access page role rename', () => {
  test.skip(LIVE, AUDITED_WRITES_SKIP_REASON);
  let staged: { original: string; renamed: string } | undefined;

  /**
   * The grant stays under the original name whatever the role is called when the
   * test stops, and deleting a role removes only the grants under its own name,
   * so the role takes its original name back before it is deleted.
   */
  test.afterEach(async ({ page }) => {
    if (!staged) return;
    const { original, renamed } = staged;
    staged = undefined;
    if (await isListed(page, 'roles', renamed)) await renameRole(page, renamed, original);
    await deleteFromList(page, 'roles', original);
  });

  test('a renamed role leaves its grants under its old name', async ({ page }) => {
    const original = uniqueName('E2E Usage Role');
    const renamed = uniqueName('E2E Renamed Role');
    staged = { original, renamed };
    await createRole(page, original);
    await grantReadUsage(page, original);
    await expect(await grantsRow(page, original)).toContainText('1 capabilities');

    await renameRole(page, original, renamed);
    await expect(await grantsRow(page, renamed)).toContainText('No capabilities');

    await renameRole(page, renamed, original);
    await expect(await grantsRow(page, original)).toContainText('1 capabilities');
  });
});
