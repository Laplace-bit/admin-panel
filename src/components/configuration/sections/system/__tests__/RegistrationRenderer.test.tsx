import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderSections } from '@/test/sections';

const YAML = {
  registration: {
    socialLogins: ['openid', 'google'],
    allowedDomains: ['gmail.com', 'example.com'],
  },
};

function addDomain(text: string) {
  const input = screen.getByRole('textbox', { name: 'Add a domain' });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('RegistrationRenderer', () => {
  it('shows social sign-in providers by name, read-only', () => {
    renderSections({ sections: ['registration'], yaml: YAML });
    expect(screen.getByText('OpenID Connect')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText(/reads this list from librechat.yaml only/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove openid/i })).not.toBeInTheDocument();
  });

  it('adds domains as chips, normalized and validated', () => {
    const onChange = vi.fn();
    renderSections({ sections: ['registration'], yaml: YAML, onChange });
    addDomain('not a domain');
    expect(screen.getByRole('alert')).toHaveTextContent("isn't a domain");
    addDomain('gmail.com');
    expect(screen.getByRole('alert')).toHaveTextContent('already in the list');
    expect(onChange).not.toHaveBeenCalled();
    addDomain(' @LibreChat.AI ');
    expect(onChange).toHaveBeenCalledWith('registration.allowedDomains', [
      'gmail.com',
      'example.com',
      'librechat.ai',
    ]);
    expect(screen.getByText('Sign-up is limited to 3 domains.')).toBeInTheDocument();
  });

  it('asks before an empty list lets anyone sign up, then stores the empty list', () => {
    const onChange = vi.fn();
    renderSections({ sections: ['registration'], yaml: YAML, onChange });
    fireEvent.click(screen.getByRole('button', { name: 'Remove gmail.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove example.com' }));
    const dialog = screen.getByRole('dialog', { name: 'Let anyone sign up?' });
    expect(onChange).toHaveBeenLastCalledWith('registration.allowedDomains', ['example.com']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Let anyone sign up' }));
    expect(onChange).toHaveBeenLastCalledWith('registration.allowedDomains', []);
    expect(screen.getByText('Anyone with an email address can sign up.')).toBeInTheDocument();
  });

  it('asks before removing the last domain of an admin list too', () => {
    const onChange = vi.fn();
    renderSections({
      sections: ['registration'],
      overrides: { registration: { allowedDomains: ['acme.com'] } },
      onChange,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove acme.com' }));
    const dialog = screen.getByRole('dialog', { name: 'Let anyone sign up?' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Let anyone sign up' }));
    expect(onChange).toHaveBeenLastCalledWith('registration.allowedDomains', undefined);
  });

  it('shows the settings LibreChat sets up at startup read-only', () => {
    renderSections({
      sections: ['registration'],
      yaml: YAML,
      overrides: { registration: { oauthStateTtlMs: 60000 } },
    });
    expect(screen.getByText(/sets up social sign-in and OpenID discovery/)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: /OAuth state TTL/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove stale override' })).toBeInTheDocument();
  });
});
