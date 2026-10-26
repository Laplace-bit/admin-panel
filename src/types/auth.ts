import type { SerializableUser } from './server';
import type { ApiErrorBody } from './changes';

export type FieldErrors = {
  email?: string;
  password?: string;
};

export type AuthStep = 'login' | '2fa';

export interface AuthCardProps {
  redirectTo?: string;
  autoRedirectSso?: boolean;
  ssoAvailable?: boolean;
}

/**
 * Why a sign-in step failed. Server functions return it and the page words it
 * (`AUTH_ERROR_KEYS`), so no server-side English reaches the sign-in screens.
 */
export type AuthErrorCode =
  | 'tenant_required'
  | 'not_admin'
  | 'federated_login'
  | 'invalid_credentials'
  | 'email_not_verified'
  | 'rate_limited'
  | 'login_failed'
  | 'unreachable'
  | 'totp_invalid'
  | 'totp_expired'
  | 'session_invalid'
  | 'verification_failed'
  | 'sso_start_failed'
  | 'sso_auth_failed'
  | 'sso_pkce_failed'
  | 'sso_failed'
  | 'sso_verifier_lost'
  | 'sso_code_invalid'
  | 'sso_code_expired'
  | 'sso_exchange_failed';

/** A failed sign-in step, as a server function returns it. */
export interface AuthFailure {
  error: true;
  code: AuthErrorCode;
}

/** An error reply of LibreChat's auth routes: `code` (pre-auth guards, capabilities) or `error_code` (admin OAuth). */
export interface AuthErrorBody extends ApiErrorBody {
  error_code?: string;
}

/** What LibreChat's admin OAuth routes put on the panel's callback URL: an exchange code, or an error. */
export interface SsoCallbackSearch {
  code?: string;
  error?: string;
}

/** A completed sign-in step: the admin the session now holds. */
export interface AuthSuccess {
  error: false;
  user: SerializableUser;
}

/** A password sign-in that needs the second factor, with the token `adminVerify2FAFn` takes. */
export interface AuthTwoFactorPending {
  error: false;
  requires2FA: true;
  tempToken?: string;
}

/** SSO started: where the browser goes next (LibreChat's admin OpenID route). */
export interface SsoStart {
  error: false;
  authUrl: string;
}

/** What `openidLoginFn` returns. */
export type SsoStartResult = AuthFailure | SsoStart;

/** What `adminVerify2FAFn` and `oauthExchangeFn` return. */
export type AuthResult = AuthFailure | AuthSuccess;

/** What `adminLoginFn` returns. */
export type AdminLoginResult = AuthResult | AuthTwoFactorPending;

/** Trades the callback's one-time code for the admin's session (`oauthExchangeFn`). */
export type SsoExchange = (code: string) => Promise<AuthResult>;

export interface SsoErrorProps {
  code: AuthErrorCode;
}
