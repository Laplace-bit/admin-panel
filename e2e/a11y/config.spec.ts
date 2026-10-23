import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CONFIG_TABS, LIVE, LIVE_SKIP_REASON, openConfigTab } from '../live';

/**
 * Accessibility and visual-system guardrails for the configuration page (VS-12):
 * axe on every tab at 1440 and 390 px in both themes, layout invariants of the
 * settings grid, and screenshot baselines. Needs a live backend (see ../live.ts);
 * refresh baselines with `--update-snapshots` after intended visual changes.
 */
test.skip(!LIVE, LIVE_SKIP_REASON);

const VIEWPORTS = [
  { label: '1440', width: 1440, height: 900 },
  { label: '390', width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);
const MAX_EXPAND_CLICKS = 250;

/** Opens collapsed sections and groups (not entry cards or select triggers) so axe sees their rows. */
async function expandSections(page: Page) {
  const triggers = page.locator(
    'form :is(h2, h3, h4, h5, h6) > button[aria-expanded="false"]:not([aria-haspopup])',
  );
  for (let clicks = 0; clicks < MAX_EXPAND_CLICKS; clicks++) {
    const next = triggers.first();
    if ((await next.count()) === 0) break;
    await next.click();
  }
  await expect(page.locator('form .config-section-grid-closed:not([inert])')).toHaveCount(0);
  await page.waitForTimeout(300);
}

async function hideDevtools(page: Page) {
  await page.addStyleTag({
    content: 'button[aria-label="Open TanStack Devtools"] { display: none !important; }',
  });
}

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test.describe(`axe: ${theme} ${viewport.label}px`, () => {
      test.use({
        colorScheme: theme,
        viewport: { width: viewport.width, height: viewport.height },
      });
      test.describe.configure({ timeout: 120_000 });

      for (const tab of CONFIG_TABS) {
        test(`${tab} has no serious or critical violations`, async ({ page }) => {
          await openConfigTab(page, tab);
          await hideDevtools(page);
          await expandSections(page);
          const results = await new AxeBuilder({ page }).analyze();
          const blocking = results.violations
            .filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''))
            .map((violation) => ({
              rule: violation.id,
              impact: violation.impact,
              targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
            }));
          expect(blocking).toEqual([]);
        });
      }
    });
  }
}

/** Serious or critical axe violations inside the open dialog. */
async function dialogViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  return results.violations
    .filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''))
    .map((violation) => ({
      rule: violation.id,
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
    }));
}

for (const theme of THEMES) {
  test.describe(`axe on dialogs: ${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: 1440, height: 900 } });

    test('search, with a result selected', async ({ page }) => {
      await openConfigTab(page, 'system');
      await page.keyboard.press('Control+k');
      await page.keyboard.type('title');
      await expect(page.locator('[cmdk-item]').first()).toBeVisible();
      await page.keyboard.press('ArrowDown');
      expect(await dialogViolations(page)).toEqual([]);
    });

    test('the change review', async ({ page }) => {
      await openConfigTab(page, 'system');
      const field = page.locator('#balance-refillAmount');
      await field.fill('12345');
      await field.press('Tab');
      await page.getByRole('button', { name: 'Review & save' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });

    test('the change review of a spec list taking over librechat.yaml (its warning text)', async ({
      page,
    }) => {
      await openConfigTab(page, 'specs');
      const card = page.locator('[data-entry-card]').first();
      test.skip((await card.count()) === 0, 'No model specs');
      await card.locator('button[aria-expanded]').first().click();
      const label = page.locator('#modelSpecs-list-0-label');
      await label.fill(`${await label.inputValue()} (review)`);
      await label.press('Tab');
      await page.getByRole('button', { name: 'Review & save' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });

    test('the import wizard', async ({ page }) => {
      await openConfigTab(page, 'system');
      await page.getByRole('button', { name: 'Import YAML' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });
  });
}

/** The Wave 2 editors' overlays at phone width, where their bodies scroll. */
for (const theme of THEMES) {
  test.describe(`axe on editor overlays: ${theme} 390px`, () => {
    test.use({ colorScheme: theme, viewport: { width: 390, height: 844 } });

    test('the Azure group details drawer', async ({ page }) => {
      await openConfigTab(page, 'providers');
      await page.locator('#section-endpoints\\.azureOpenAI .settings-section-trigger').click();
      /** The group with the longest model list, so the drawer body scrolls at this height. */
      const counts = await page
        .locator('.azure-groups-table tbody tr .azure-col-number')
        .allInnerTexts();
      const longest = counts.reduce(
        (best, text, i) => (Number(text) > Number(counts[best]) ? i : best),
        0,
      );
      await page
        .getByRole('button', { name: /^Details of Azure group/ })
        .nth(longest)
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });

    test('the custom endpoint editor drawer', async ({ page }) => {
      await openConfigTab(page, 'custom');
      await page.locator('li[data-endpoint-row] button[aria-haspopup="dialog"]').first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });

    test('Create endpoint', async ({ page }) => {
      await openConfigTab(page, 'custom');
      await page.getByRole('button', { name: 'Create endpoint' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });

    test('Create MCP server', async ({ page }) => {
      await openConfigTab(page, 'mcp');
      await page.getByRole('button', { name: 'Create MCP server' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });
  });
}

test.describe('row action menus', () => {
  test.use({ colorScheme: 'light', viewport: { width: 1440, height: 900 } });

  test('custom: an action that opens the editor leaves focus in it', async ({ page }) => {
    await openConfigTab(page, 'custom');
    const trigger = page.getByRole('button', { name: /^Actions for / }).first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect
      .poll(() => drawer.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
  });

  for (const tab of ['custom', 'mcp'] as const) {
    test(`${tab}: Escape returns focus to the menu button`, async ({ page }) => {
      await openConfigTab(page, tab);
      const trigger = page.getByRole('button', { name: /^Actions for / }).first();
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  }
});

test.describe('settings layout invariants (1440px, light)', () => {
  test.use({
    colorScheme: 'light',
    contextOptions: { reducedMotion: 'reduce' },
    viewport: { width: 1440, height: 900 },
  });
  test.describe.configure({ timeout: 120_000 });

  for (const tab of CONFIG_TABS) {
    test(`${tab}: full-opacity rows, one control column, headed sections`, async ({ page }) => {
      await openConfigTab(page, tab);
      await expandSections(page);

      const report = await page.evaluate(() => {
        const CONTAINERS = [
          'settings-section-body',
          'settings-group-body',
          'settings-section',
          'settings-group',
          'settings-section-sole',
          'config-section-inner',
          'config-section-grid',
        ];
        const form = document.querySelector('form.settings-content');
        const rows = [...document.querySelectorAll<HTMLElement>('form .settings-row')].filter(
          (row) => !row.closest('[inert]'),
        );

        const faded = rows.filter((row) => {
          for (let el: HTMLElement | null = row; el && el !== form; el = el.parentElement) {
            if (Number(getComputedStyle(el).opacity) < 1) return true;
          }
          return false;
        });

        /** Rows placed by the settings containers themselves (not inside entry cards). */
        const gridRows = rows.filter((row) => {
          for (let el = row.parentElement; el && el !== form; el = el.parentElement) {
            if (!CONTAINERS.some((name) => el.classList.contains(name))) return false;
          }
          return row.getBoundingClientRect().height > 0;
        });
        /** The control cell, or a bare control a single-field section places in that column. */
        const controlCell = (row: HTMLElement) =>
          row.querySelector(
            ':scope > .settings-row-control, :scope > .settings-row-sole > .settings-row-control',
          ) ??
          row.querySelector(
            ':scope > :not(.settings-row-label, .settings-row-trailing, .settings-row-sole)',
          );
        const controlXs = new Set(
          gridRows.map((row) => Math.round(controlCell(row)?.getBoundingClientRect().left ?? -1)),
        );

        const unheadedSections = [
          ...document.querySelectorAll<HTMLElement>('form section[data-settings-section]'),
        ].filter((section) => !section.querySelector('h2'));
        const unheadedGroups = [
          ...document.querySelectorAll<HTMLElement>('form section.settings-group'),
        ].filter((group) => !group.querySelector(':scope > div :is(h3, h4, h5, h6)'));

        return {
          rows: rows.length,
          faded: faded.map((row) => row.querySelector('.settings-label')?.textContent ?? ''),
          gridRows: gridRows.length,
          controlXs: [...controlXs],
          unheadedSections: unheadedSections.map((s) => s.id),
          unheadedGroups: unheadedGroups.map((g) => g.id),
        };
      });

      expect(report.faded, 'rows drawn below full opacity').toEqual([]);
      expect(report.unheadedSections).toEqual([]);
      expect(report.unheadedGroups).toEqual([]);
      if (report.gridRows > 0) {
        expect(report.controlXs, 'every settings control starts at the same x').toHaveLength(1);
      }
    });
  }
});

const VISUAL_TABS = ['system', 'features', 'custom'] as const;
const VISUAL_VARIANTS = [
  { label: 'light-1440', colorScheme: 'light', width: 1440, height: 1100 },
  { label: 'dark-1440', colorScheme: 'dark', width: 1440, height: 1100 },
  { label: 'light-390', colorScheme: 'light', width: 390, height: 1100 },
] as const;

for (const variant of VISUAL_VARIANTS) {
  test.describe(`visual baseline: ${variant.label}`, () => {
    test.use({
      colorScheme: variant.colorScheme,
      viewport: { width: variant.width, height: variant.height },
    });

    for (const tab of VISUAL_TABS) {
      test(`${tab}`, async ({ page }) => {
        await openConfigTab(page, tab);
        await hideDevtools(page);
        await expect(page).toHaveScreenshot(`${tab}-${variant.label}.png`, {
          animations: 'disabled',
          maxDiffPixelRatio: 0.02,
        });
      });
    }
  });
}

test.describe('dialogs give focus back to what opened them', () => {
  test.use({ colorScheme: 'light', viewport: { width: 1440, height: 900 } });

  test('Create MCP server, closed with Escape', async ({ page }) => {
    await openConfigTab(page, 'mcp');
    const create = page.getByRole('button', { name: 'Create MCP server' });
    await create.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(create).toBeFocused();
  });

  test('the change review, closed with Escape', async ({ page }) => {
    await openConfigTab(page, 'system');
    const field = page.locator('#balance-refillAmount');
    await field.fill('12345');
    await field.press('Tab');
    const review = page.getByRole('button', { name: 'Review & save' });
    await review.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(review).toBeFocused();
  });
});

test.describe('custom endpoint drawer', () => {
  test.use({ colorScheme: 'light', viewport: { width: 1440, height: 900 } });

  test('a section link scrolls the drawer to its section', async ({ page }) => {
    await openConfigTab(page, 'custom');
    await page.locator('li[data-endpoint-row] button[aria-haspopup="dialog"]').first().click();
    const drawer = page.locator('[data-endpoint-drawer]');
    await expect(drawer).toBeVisible();
    const links = drawer.locator('nav a');
    await links.last().click();
    await expect(links.last()).toHaveAttribute('aria-current', 'location');
    const scrolled = () =>
      drawer.locator('nav').evaluate((nav) => {
        let node = nav.parentElement;
        while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
          node = node.parentElement;
        }
        return node?.scrollTop ?? 0;
      });
    await expect.poll(scrolled).toBeGreaterThan(0);
  });
});
