import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ConfigLoadError } from '../ConfigLoadError';
import '@/locales/i18n';

async function nextFrame() {
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

type LoadState = 'error' | 'loading' | 'ready';

/**
 * The configuration page in the app layout: the header's title is always
 * there. A retry swaps the error card for a skeleton (`aria-busy`) until it
 * ends with the page, or with a new error card in its place (the route and
 * the page both mount a new one). With `tabsWhileLoading`, the tab bar shows
 * around the card and the skeleton, as the page's own load errors have it.
 */
function Page({ tabsWhileLoading = false }: { tabsWhileLoading?: boolean }) {
  const [state, setState] = useState<LoadState>('error');
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setAttempt((n) => n + 1);
    setState('loading');
  };
  return (
    <>
      <header>
        <h1 tabIndex={-1}>Configuration</h1>
      </header>
      {(tabsWhileLoading || state === 'ready') && (
        <div role="tablist">
          <button type="button" role="tab" data-state="active">
            Providers
          </button>
        </div>
      )}
      {state === 'error' && (
        <ConfigLoadError key={attempt} error={new Error('boom')} onRetry={retry} />
      )}
      {state === 'loading' && (
        <div role="status" aria-busy="true">
          <button type="button" onClick={() => setState('ready')}>
            Finish loading
          </button>
          <button type="button" onClick={() => setState('error')}>
            Fail again
          </button>
        </div>
      )}
    </>
  );
}

async function retryThen(outcome: 'Finish loading' | 'Fail again') {
  const retry = screen.getByRole('button', { name: 'Retry' });
  retry.focus();
  fireEvent.click(retry);
  expect(screen.queryByRole('alert')).toBeNull();
  await nextFrame();
  expect(document.body).toHaveFocus();
  act(() => screen.getByRole('button', { name: outcome }).click());
  await nextFrame();
  await nextFrame();
}

describe('ConfigLoadError', () => {
  it.each([
    ['the route', false],
    ['the page', true],
  ])('puts focus on the open tab once a retry has loaded %s', async (_where, tabsWhileLoading) => {
    render(<Page tabsWhileLoading={tabsWhileLoading} />);
    await retryThen('Finish loading');
    expect(screen.getByRole('tab', { name: 'Providers' })).toHaveFocus();
  });

  it.each([
    ['the route', false],
    ['the page', true],
  ])(
    'gives focus to the Retry of the card %s shows again when a retry fails again',
    async (_where, tabsWhileLoading) => {
      render(<Page tabsWhileLoading={tabsWhileLoading} />);
      await retryThen('Fail again');
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
    },
  );
});
