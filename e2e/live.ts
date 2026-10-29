import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';

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

/**
 * A live LibreChat appends an audit entry for every role, group and grant
 * write (`role.created`, `grant.assigned`, `group.deleted`, ...) and for every
 * audit-log export, and its admin API cannot delete audit entries. A test whose
 * purpose is one of those writes would add history named after its role or
 * group on every live run, so it runs against the mock only. Two kinds of live
 * entries remain: the Groups-tab tests create and delete two groups once per
 * run, because a fresh LibreChat has no groups to list, and every read of the
 * audit log appends an `audit.read` entry, which names no role or group.
 */
export const AUDITED_WRITES_SKIP_REASON =
  'Writes roles, groups or grants, which a live LibreChat records in an audit log its admin API cannot delete';

/** The mock backend playwright.config.ts starts, and the admin token it accepts. */
export const MOCK_BACKEND_URL = 'http://localhost:3081';
export const MOCK_ADMIN_HEADERS = { Authorization: 'Bearer test-admin-token' };

export const CONFIG_TABS = [
  'providers',
  'custom',
  'specs',
  'mcp',
  'features',
  'files',
  'system',
] as const;

export const THEMES = ['light', 'dark'] as const;

/** The WCAG 2.0 and 2.1 level A and AA rules the panel's axe scans run. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Opens a configuration tab, in the profile of `scope` (e.g. `role:USER`) if
 * given, and waits until its form has rendered real fields.
 */
export async function openConfigTab(page: Page, tab: string, scope?: string) {
  await page.goto(`/configuration?tab=${tab}${scope ? `&scope=${scope}` : ''}`);
  const form = page.getByRole('form', { name: 'Configuration' });
  await expect(form).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]']);

/** One key per panel, however E2E_BASE_URL spells its loopback host or trailing slash. */
function lockKey(baseUrl: string): string {
  const url = new URL(baseUrl);
  const host = LOOPBACK_HOSTS.has(url.hostname) ? 'localhost' : url.hostname;
  const path = url.pathname.replace(/\/+$/, '');
  return `${host}-${url.port}${path}`.replace(/[^a-z0-9]+/gi, '-');
}

const LOCK_KEY = lockKey(process.env.E2E_BASE_URL ?? 'http://localhost:3000');
const LOCK_DIR = join(tmpdir(), `librechat-admin-e2e-user-profile-${LOCK_KEY}`);
const LOCK_POLL_MS = 250;
/** Longer than a locked test holds the lock, unless its body and its cleanup both hang. */
const LOCK_STALE_MS = 5 * 60_000;
/** Past the stale age, so a waiter takes over a hung holder's lock before it gives up. */
const LOCK_WAIT_MS = LOCK_STALE_MS + 60_000;

let lockHeld = false;

function lockOwner(dir: string): number | undefined {
  try {
    const pid = Number(readFileSync(join(dir, 'owner'), 'utf8'));
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A lock is stale when its owner has exited, is this worker (one test runs at a time per
 * worker, so it leaked), or has held it past the stale age. A lock whose owner file is not
 * written yet is judged by age alone.
 */
function isStale(dir: string): boolean {
  const pid = lockOwner(dir);
  if (pid != null && (pid === process.pid || !isAlive(pid))) return true;
  try {
    return Date.now() - statSync(dir).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * Moves a stale lock aside and deletes it. When the move fails, another waiter got there
 * first; when the lock moved aside is not stale, a waiter re-took it in between, so it goes back.
 */
function takeOver() {
  const aside = `${LOCK_DIR}.stale-${process.pid}-${Date.now()}`;
  try {
    renameSync(LOCK_DIR, aside);
    if (!isStale(aside)) renameSync(aside, LOCK_DIR);
  } catch {
    /* Another waiter moved it first, or took the lock while it was aside. */
  } finally {
    rmSync(aside, { recursive: true, force: true });
  }
}

/** One attempt: `mkdir` is atomic and fails while another worker holds the lock. */
function tryLock(): boolean {
  try {
    mkdirSync(LOCK_DIR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (isStale(LOCK_DIR)) takeOver();
    return false;
  }
  writeFileSync(join(LOCK_DIR, 'owner'), String(process.pid));
  return true;
}

function releaseLock() {
  if (!lockHeld) return;
  lockHeld = false;
  process.off('exit', releaseLock);
  if (lockOwner(LOCK_DIR) === process.pid) rmSync(LOCK_DIR, { recursive: true, force: true });
}

/** Waits for the lock without spending the test's own timeout on the wait. */
async function acquireLock(testInfo: TestInfo) {
  const started = Date.now();
  const timeout = testInfo.timeout;
  if (timeout) testInfo.setTimeout(timeout + LOCK_WAIT_MS);
  while (!tryLock()) {
    if (Date.now() - started > LOCK_WAIT_MS) {
      const holder = lockOwner(LOCK_DIR) ?? 'unknown';
      throw new Error(
        `Gave up after ${LOCK_WAIT_MS / 1000} s waiting for the USER role profile lock ` +
          `${LOCK_DIR}, held by pid ${holder}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
  lockHeld = true;
  process.on('exit', releaseLock);
  if (timeout) testInfo.setTimeout(timeout + Date.now() - started);
}

/**
 * Runs each test of the calling describe alone against E2E_BASE_URL's backend, across workers
 * and spec files. Every test that creates, uses or deletes the USER role's profile calls it:
 * there are only two built-in roles, so no test gets a profile of its own. `cleanup` runs
 * before the lock is released, also after a failure.
 */
export function lockUserProfile(cleanup?: (page: Page) => Promise<void>) {
  test.beforeEach(() => acquireLock(test.info()));
  test.afterEach(async ({ page }) => {
    try {
      await cleanup?.(page);
    } finally {
      releaseLock();
    }
  });
}

/** Opens the scope selector once its profile list has loaded. */
export async function openScopeSelector(page: Page) {
  await page.getByRole('button', { name: /^Select scope/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('option', { name: /^Base configuration/ })).toBeVisible();
  return dialog;
}

/**
 * Opens the USER role's profile; on a clean database, creating it opens it.
 * Returns whether it created the profile. Call it under `lockUserProfile`.
 */
export async function selectUserRoleProfile(page: Page): Promise<boolean> {
  const dialog = await openScopeSelector(page);
  const user = dialog.getByRole('option', { name: /^USER / });
  if ((await user.count()) > 0) {
    await user.click();
    return false;
  }
  await dialog.getByRole('button', { name: 'Create' }).click();
  await dialog.getByRole('option', { name: 'USER', exact: true }).click();
  return true;
}

/**
 * Deletes the USER role's profile, unless something has saved overrides to it
 * since and `force` is unset (a test deleting a profile it created passes it).
 * The confirm view lists no options and stays up until the delete succeeds,
 * so the profile list coming back is what proves the delete finished.
 */
export async function deleteUserRoleProfile(page: Page, force = false) {
  await openConfigTab(page, 'system');
  const dialog = await openScopeSelector(page);
  const user = dialog.getByRole('option', { name: /^USER / });
  if (!force && (await user.filter({ hasText: 'No overrides' }).count()) === 0) return;
  await dialog.getByRole('option', { name: 'Delete profile USER', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete configuration' }).click();
  await expect(dialog.getByRole('option', { name: /^Base configuration/ })).toBeVisible({
    timeout: 10_000,
  });
  await expect(user).toHaveCount(0);
}

/** click-ui Selects for the a11y specs: each `open` loads the Select's page and returns its trigger. */
export const SELECTS = [
  {
    name: 'the audit log Target type filter',
    open: async (page: Page) => {
      await page.goto('/grants?tab=audit-log');
      await page.waitForLoadState('networkidle');
      return page.getByRole('button', { name: 'Target type' });
    },
  },
  {
    name: 'the configuration Jump to list',
    open: async (page: Page) => {
      await page.setViewportSize({ width: 1024, height: 800 });
      await openConfigTab(page, 'system');
      return page.getByRole('button', { name: 'Jump to…' });
    },
  },
] as const;
