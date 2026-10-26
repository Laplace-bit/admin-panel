import type * as t from '@/types';
import { EXCHANGE_CODE_PATTERN, SSO_CALLBACK_ERRORS } from '@/constants';

/**
 * The failure an `error` of LibreChat's admin OAuth callback names. Any value
 * the panel does not know is `sso_failed`: the query is never shown as text.
 */
export function ssoCallbackError(error: string): t.AuthErrorCode {
  return SSO_CALLBACK_ERRORS.get(error) ?? 'sso_failed';
}

/**
 * The callback's query as TanStack parsed it: each value is JSON-parsed, so
 * `?code=1234` arrives as a number. A code that is not text is no code; an
 * error that is not text is one the panel does not know (`sso_failed`).
 */
export function parseSsoCallbackSearch(search: Record<string, unknown>): t.SsoCallbackSearch {
  return {
    code: typeof search.code === 'string' ? search.code : undefined,
    error: search.error === undefined ? undefined : String(search.error),
  };
}

/**
 * Completes the OpenID callback: the failure LibreChat redirected with, else
 * the exchange of its one-time code; `null` once the session holds the admin.
 * A missing or malformed code, or an exchange that throws, is `sso_exchange_failed`.
 */
export async function resolveSsoCallback(
  { code, error }: t.SsoCallbackSearch,
  exchange: t.SsoExchange,
): Promise<t.AuthErrorCode | null> {
  if (error) return ssoCallbackError(error);
  if (!code || !EXCHANGE_CODE_PATTERN.test(code)) return 'sso_exchange_failed';
  try {
    const result = await exchange(code);
    return result.error ? result.code : null;
  } catch {
    return 'sso_exchange_failed';
  }
}
