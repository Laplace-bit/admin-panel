import type { TUser } from 'librechat-data-provider';

export type SerializableUser = Pick<TUser, 'id' | 'email' | 'name' | 'role'>;

export interface SessionData {
  user?: SerializableUser;
  token?: string;
  refreshToken?: string;
  tokenProvider?: 'librechat' | 'openid';
  /** Absolute expiry of `token` (ms epoch). Drives proactive refresh. */
  expiresAt?: number;
  lastVerified?: number;
  lastActivity?: number;
  codeVerifier?: string;
}

/** What the `admin-session` cookie seals: the envelope TanStack Start's former `useSession` (h3) wrote. */
export interface SessionRecord {
  id: string;
  createdAt: number;
  data: SessionData;
}

/** The current request's admin session. */
export interface SessionManager {
  readonly data: SessionData;
  /** Merges the fields into the session and reissues its cookie. */
  update: (update: Partial<SessionData>) => Promise<void>;
}

export interface SessionCookieOptions {
  path: string;
  secure: boolean;
  sameSite: 'lax';
  httpOnly: true;
  maxAge: number;
}

export interface SessionSettings {
  password: string;
  cookie: SessionCookieOptions;
}

/** One `Set-Cookie` of a chunked cookie write; `remove` expires that cookie. */
export interface CookieWrite {
  name: string;
  value: string;
  remove: boolean;
}

export interface AdminLoginResponse {
  token: string;
  user: SerializableUser;
  twoFAPending?: boolean;
  tempToken?: string;
}

export interface TwoFAVerifyResponse {
  token: string;
  user: SerializableUser;
}

export interface AdminVerifyResponse {
  user: SerializableUser;
}

export interface OAuthExchangeResponse {
  token: string;
  refreshToken?: string;
  user: SerializableUser;
  expiresAt?: number;
}

/** One page of an admin list endpoint: the items at an offset, and how many exist in all. */
export interface ListPage<T> {
  items: T[];
  total: number;
}
