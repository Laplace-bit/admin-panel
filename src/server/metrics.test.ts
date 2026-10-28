import { describe, expect, it } from 'vitest';
import { SSO_PROVIDER_IDS } from '@/constants';
import { normalizeMetricsPath } from './metrics';
import { ssoCallbackPath } from '@/utils';

describe('normalizeMetricsPath', () => {
  it.each([
    ['/', '/'],
    ['/login', '/login'],
    ['/configuration/', '/configuration'],
    ['/auth/openid/callback', '/auth/openid/callback'],
  ])('keeps known app route %s bounded as %s', (input, expected) => {
    expect(normalizeMetricsPath(input)).toBe(expected);
  });

  it.each(SSO_PROVIDER_IDS.map(ssoCallbackPath))(
    'keeps the SSO callback %s of every provider as its own route',
    (path) => {
      expect(normalizeMetricsPath(path)).toBe(path);
      expect(normalizeMetricsPath(`${path}/`)).toBe(path);
    },
  );

  it('buckets the callback of a provider the panel does not offer as unknown', () => {
    expect(normalizeMetricsPath('/auth/evil/callback')).toBe('unknown');
  });

  it.each([
    ['/assets/index-abc123.js'],
    ['/favicon.ico'],
    ['/manifest.json'],
    ['/clickhouse-dark.svg'],
  ])('buckets static asset %s', (input) => {
    expect(normalizeMetricsPath(input)).toBe('static_asset');
  });

  it.each([
    ['/_server'],
    ['/_server/getUsersFn'],
    ['/_serverFn/getUsersFn'],
    ['/api/_server/getUsersFn'],
  ])('buckets server function path %s', (input) => {
    expect(normalizeMetricsPath(input)).toBe('server_function');
  });

  it.each([['/wp-login.php'], ['/users/123'], ['not-a-path']])(
    'buckets unknown path %s',
    (input) => {
      expect(normalizeMetricsPath(input)).toBe('unknown');
    },
  );
});
