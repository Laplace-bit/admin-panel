import '@/locales/i18n';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderSections } from '@/test/sections';

describe('RateLimitsRenderer', () => {
  it('lists every limiter with librechat.yaml values or LibreChat defaults, read-only', () => {
    renderSections({
      sections: ['rateLimits'],
      yaml: { rateLimits: { fileUploads: { userMax: 20, userWindowInMinutes: 5 } } },
    });
    const table = screen.getByRole('table', { name: 'Rate limits' });
    const uploads = within(table).getByRole('row', { name: /File uploads/ });
    expect(uploads).toHaveTextContent('100 requests / 15 min');
    expect(uploads).toHaveTextContent('20 requests / 5 min');
    expect(within(uploads).getByText('librechat.yaml')).toBeInTheDocument();
    const agents = within(table).getByRole('row', { name: /Agent events/ });
    expect(agents).toHaveTextContent('Not limited');
    expect(agents).toHaveTextContent('40 requests / 1 min');
    expect(screen.getByText(/never applied, even after a restart/)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });
});
