import { describe, expect, it, vi } from 'vitest';
import type * as t from '@/types';
import { parseSsoCallbackSearch, resolveSsoCallback, ssoCallbackError } from './auth';
import translation from '@/locales/en/translation.json';
import { AUTH_ERROR_KEYS } from '@/constants';

const CODE = 'a'.repeat(64);

describe('ssoCallbackError', () => {
  it.each([
    ['TENANT_CONTEXT_REQUIRED', 'tenant_required'],
    ['auth_failed', 'sso_auth_failed'],
    ['pkce_store_failed', 'sso_pkce_failed'],
    ['pkce_retrieval_failed', 'sso_pkce_failed'],
  ])('reads LibreChat callback error %s as %s', (error, code) => {
    expect(ssoCallbackError(error)).toBe(code);
  });

  it.each(['access_denied', '<img src=x onerror=alert(1)>', 'tenant_context_required'])(
    'reads an unknown error (%s) as the generic failure, never as its text',
    (error) => {
      expect(ssoCallbackError(error)).toBe('sso_failed');
    },
  );
});

describe('parseSsoCallbackSearch', () => {
  it('keeps the code and error LibreChat sent as text', () => {
    expect(
      parseSsoCallbackSearch({ code: CODE, error: 'auth_failed', error_description: 'Failed' }),
    ).toEqual({ code: CODE, error: 'auth_failed' });
  });

  it('reads a value TanStack parsed as JSON as no code, or an unknown error', async () => {
    const search = parseSsoCallbackSearch({ code: 1234, error: { html: '<b>x</b>' } });

    expect(search.code).toBeUndefined();
    expect(await resolveSsoCallback(search, vi.fn<t.SsoExchange>())).toBe('sso_failed');
    expect(
      await resolveSsoCallback(parseSsoCallbackSearch({ code: 1234 }), vi.fn<t.SsoExchange>()),
    ).toBe('sso_exchange_failed');
  });
});

describe('resolveSsoCallback', () => {
  it('reports the error LibreChat redirected with without spending a code', async () => {
    const exchange = vi.fn<t.SsoExchange>();

    const result = await resolveSsoCallback(
      { code: CODE, error: 'TENANT_CONTEXT_REQUIRED' },
      exchange,
    );

    expect(result).toBe('tenant_required');
    expect(exchange).not.toHaveBeenCalled();
  });

  it.each([{}, { code: 'not-hex' }, { code: '' }])(
    'fails a callback without a well-formed code (%j) without exchanging it',
    async (search) => {
      const exchange = vi.fn<t.SsoExchange>();

      expect(await resolveSsoCallback(search, exchange)).toBe('sso_exchange_failed');
      expect(exchange).not.toHaveBeenCalled();
    },
  );

  it('completes once the exchange signs the admin in', async () => {
    const exchange = vi.fn<t.SsoExchange>().mockResolvedValue({
      error: false,
      user: { id: 'user-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
    });

    expect(await resolveSsoCallback({ code: CODE }, exchange)).toBeNull();
    expect(exchange).toHaveBeenCalledWith(CODE);
  });

  it("keeps the exchange's own failure", async () => {
    const exchange = vi.fn<t.SsoExchange>().mockResolvedValue({
      error: true,
      code: 'sso_code_expired',
    });

    expect(await resolveSsoCallback({ code: CODE }, exchange)).toBe('sso_code_expired');
  });

  it('fails an exchange that throws', async () => {
    const exchange = vi.fn<t.SsoExchange>().mockRejectedValue(new Error('network'));

    expect(await resolveSsoCallback({ code: CODE }, exchange)).toBe('sso_exchange_failed');
  });
});

describe('AUTH_ERROR_KEYS', () => {
  it('words every sign-in failure with an English phrase', () => {
    const phrases: Record<string, string> = translation;
    const missing = Object.values(AUTH_ERROR_KEYS).filter((key) => !phrases[key]);
    expect(missing).toEqual([]);
  });
});
