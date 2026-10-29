import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ConfigLoadError } from '../ConfigLoadError';
import '@/locales/i18n';

async function nextFrame() {
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

/** The configuration page: an error card until Retry loads it, then the tabs once they render. */
function Page() {
  const [state, setState] = useState<'error' | 'loading' | 'ready'>('error');
  if (state === 'error') {
    return <ConfigLoadError error={new Error('boom')} onRetry={() => setState('loading')} />;
  }
  if (state === 'loading') {
    return (
      <button type="button" onClick={() => setState('ready')}>
        Finish loading
      </button>
    );
  }
  return (
    <div role="tablist">
      <button type="button" role="tab" data-state="active">
        Providers
      </button>
    </div>
  );
}

describe('ConfigLoadError', () => {
  it('puts focus on the open tab once a retry has loaded the page', async () => {
    render(<Page />);
    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    fireEvent.click(retry);
    expect(screen.queryByRole('alert')).toBeNull();
    await nextFrame();
    expect(document.body).toHaveFocus();

    const finish = screen.getByRole('button', { name: 'Finish loading' });
    act(() => finish.click());
    await nextFrame();
    await nextFrame();
    expect(screen.getByRole('tab', { name: 'Providers' })).toHaveFocus();
  });
});
