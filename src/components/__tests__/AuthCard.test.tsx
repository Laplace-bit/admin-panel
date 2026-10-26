import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as t from '@/types';
import { adminLoginFn, adminVerify2FAFn, openidLoginFn } from '@/server';
import { localizeEn } from '@/test/coverage';
import { AuthCard } from '../AuthCard';

/** jsdom has no layout: the 2FA code input measures itself and probes what lies under it. */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver;
document.elementFromPoint ??= () => null;

const navigate = vi.fn();
const invalidate = vi.fn(async () => undefined);

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ navigate, invalidate }),
}));

vi.mock('@/server', () => ({
  adminLoginFn: vi.fn(),
  adminVerify2FAFn: vi.fn(),
  openidLoginFn: vi.fn(),
  openIdCheckOptions: { queryKey: ['openIdCheck'], queryFn: vi.fn() },
}));

const loginFn = vi.mocked(adminLoginFn);
const verify2FAFn = vi.mocked(adminVerify2FAFn);
const ssoStartFn = vi.mocked(openidLoginFn);

function renderCard(props: t.AuthCardProps = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthCard ssoAvailable={false} {...props} />
    </QueryClientProvider>,
  );
}

function signIn() {
  fireEvent.change(screen.getByPlaceholderText(localizeEn('com_auth_email_placeholder')), {
    target: { value: 'admin@example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText(localizeEn('com_auth_password_placeholder')), {
    target: { value: 'Password123!' },
  });
  fireEvent.click(screen.getByRole('button', { name: localizeEn('com_auth_sign_in') }));
}

/**
 * input-otp re-syncs the selection on timers it never clears (0, 10 and 50 ms
 * after each change of the code). On the fake clock they end with the test,
 * instead of firing into the torn-down jsdom of a finished file.
 */
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  loginFn.mockReset();
  verify2FAFn.mockReset();
  ssoStartFn.mockReset();
  navigate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Turns of the event loop React's scheduler (on `setImmediate`) may still need for work queued before the test ends. */
const SCHEDULER_TURNS = 3;

/**
 * Lets real time pass as it does once a file ends, with jsdom's window gone: a timer left behind
 * throws as it fires. Work React already scheduled runs first, with the window still there, so a
 * slow runner doesn't fail the test on React's own bookkeeping.
 */
async function idleWithoutWindow(ms: number): Promise<void> {
  for (let turn = 0; turn < SCHEDULER_TURNS; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  vi.stubGlobal('window', undefined);
  try {
    await new Promise((resolve) => setTimeout(resolve, ms));
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('AuthCard sign-in failures', () => {
  it('tells an admin refused for a missing tenant to use their organization address', async () => {
    loginFn.mockResolvedValue({ error: true, code: 'tenant_required' });

    renderCard();
    signIn();

    expect(await screen.findByText(localizeEn('com_auth_error_tenant_required'))).toBeVisible();
    expect(screen.queryByText(localizeEn('com_auth_error_not_admin'))).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('words a missing admin capability apart from the tenant refusal', async () => {
    loginFn.mockResolvedValue({ error: true, code: 'not_admin' });

    renderCard();
    signIn();

    expect(await screen.findByText(localizeEn('com_auth_error_not_admin'))).toBeVisible();
  });

  it('tells an account its identity provider owns that a password cannot sign it in', async () => {
    loginFn.mockResolvedValue({ error: true, code: 'federated_login' });

    renderCard({ ssoAvailable: true });
    signIn();

    expect(await screen.findByText(localizeEn('com_auth_error_federated_login'))).toBeVisible();
    expect(screen.queryByText(localizeEn('com_auth_error_not_admin'))).toBeNull();
  });

  it('returns to the password step when the 2FA temp token expired', async () => {
    loginFn.mockResolvedValue({ error: false, requires2FA: true, tempToken: 'temp-token' });
    verify2FAFn.mockResolvedValue({ error: true, code: 'totp_expired' });

    renderCard();
    signIn();
    const otp = await screen.findByLabelText(localizeEn('com_auth_2fa_code_label'));
    fireEvent.change(otp, { target: { value: '123456' } });

    expect(await screen.findByText(localizeEn('com_auth_2fa_expired'))).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: localizeEn('com_auth_sign_in') })).toBeVisible(),
    );
    expect(verify2FAFn).toHaveBeenCalledWith({
      data: { tempToken: 'temp-token', totpCode: '123456' },
    });
  });

  it('sends an account its identity provider owns back to the password step, where SSO is', async () => {
    loginFn.mockResolvedValue({ error: false, requires2FA: true, tempToken: 'temp-token' });
    verify2FAFn.mockResolvedValue({ error: true, code: 'federated_login' });

    renderCard({ ssoAvailable: true });
    signIn();
    const otp = await screen.findByLabelText(localizeEn('com_auth_2fa_code_label'));
    fireEvent.change(otp, { target: { value: '123456' } });

    expect(await screen.findByText(localizeEn('com_auth_error_federated_login'))).toBeVisible();
    expect(screen.queryByLabelText(localizeEn('com_auth_2fa_code_label'))).toBeNull();
    expect(screen.getByRole('button', { name: localizeEn('com_auth_sso_sign_in') })).toBeVisible();
  });

  it('words a tenant refusal on the 2FA step and stays on it', async () => {
    loginFn.mockResolvedValue({ error: false, requires2FA: true, tempToken: 'temp-token' });
    verify2FAFn.mockResolvedValue({ error: true, code: 'tenant_required' });

    renderCard();
    signIn();
    const otp = await screen.findByLabelText(localizeEn('com_auth_2fa_code_label'));
    fireEvent.change(otp, { target: { value: '123456' } });

    expect(await screen.findByText(localizeEn('com_auth_error_tenant_required'))).toBeVisible();
    expect(screen.getByLabelText(localizeEn('com_auth_2fa_code_label'))).toBeVisible();
  });

  it('leaves no timer of the 2FA step to fire once jsdom is torn down', async () => {
    loginFn.mockResolvedValue({ error: false, requires2FA: true, tempToken: 'temp-token' });
    verify2FAFn.mockResolvedValue({ error: true, code: 'totp_invalid' });

    renderCard();
    signIn();
    const otp = await screen.findByLabelText(localizeEn('com_auth_2fa_code_label'));
    fireEvent.change(otp, { target: { value: '123456' } });
    expect(await screen.findByText(localizeEn('com_auth_2fa_invalid_code'))).toBeVisible();
    cleanup();
    vi.useRealTimers();

    await idleWithoutWindow(100);
  });

  it('words a failed SSO start', async () => {
    ssoStartFn.mockResolvedValue({ error: true, code: 'sso_start_failed' });

    renderCard({ ssoAvailable: true });
    fireEvent.click(screen.getByRole('button', { name: localizeEn('com_auth_sso_sign_in') }));

    expect(await screen.findByText(localizeEn('com_auth_sso_redirect_failed'))).toBeVisible();
  });
});
