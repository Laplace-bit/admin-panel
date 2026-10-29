import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type * as t from '@/types';
import { nameWords, nestedControls, visibleText } from '@/test/a11y';
import { renderTab } from '@/test/page';

vi.mock('@tanstack/react-router', async (importOriginal) =>
  (await import('@/test/router')).routerless(importOriginal),
);

/** A server Base adds in the admin panel, with a title beside its key. */
const OVERRIDES: t.ConfigRecord = {
  mcpServers: {
    vault: { type: 'streamable-http', url: 'https://mcp.vault.dev/mcp', title: 'Vault' },
  },
};

function card(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-mcp-server="${key}"]`);
  if (!element) throw new Error(`no card for ${key}`);
  return element;
}

function header(key: string): HTMLElement {
  const button = card(key).querySelector<HTMLElement>('button[aria-expanded]');
  if (!button) throw new Error(`no header for ${key}`);
  return button;
}

async function nextFrame() {
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

describe('MCP server card header', () => {
  it('is named by every word it shows, and described by the facts line beside it', () => {
    renderTab({ tab: 'mcp', overrides: OVERRIDES });
    const button = header('vault');
    expect(button).not.toHaveAttribute('aria-label');
    expect(button).toHaveAccessibleName('Vault Name: vault');
    const named = new Set(nameWords('Vault Name: vault'));
    expect(nameWords(visibleText(button)).filter((word) => !named.has(word))).toEqual([]);

    const facts = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(facts).not.toBeNull();
    expect(button.contains(facts)).toBe(false);
    expect(facts).toHaveTextContent('https://mcp.vault.dev/mcp');
    expect(button).toHaveAccessibleDescription(/https:\/\/mcp\.vault\.dev\/mcp/);
    expect(nestedControls(card('vault'))).toEqual([]);
  });

  it('opens and closes the card from its header', () => {
    renderTab({ tab: 'mcp', overrides: OVERRIDES });
    const button = header('vault');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('gives focus back to the header when Escape cancels a rename', async () => {
    renderTab({ tab: 'mcp', overrides: OVERRIDES });
    const trigger = within(card('vault')).getByRole('button', { name: 'Actions for vault' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /^Rename/ }));
    });
    await nextFrame();
    const input = screen.getByRole('textbox', { name: 'Rename vault' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Rename vault' })).toBeNull();
    await nextFrame();
    expect(header('vault')).toHaveFocus();
  });
});
