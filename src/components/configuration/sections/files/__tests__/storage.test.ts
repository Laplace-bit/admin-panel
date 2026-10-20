import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import { isCloudFrontReady, resolveStorage, backendsInUse } from '../storage';
import { lowerValue, ownValue } from '@/utils';

function state(overrides: Partial<t.FieldState> = {}): t.FieldState {
  return {
    value: undefined,
    effective: undefined,
    source: 'default',
    isConfigured: false,
    isOverride: false,
    isEdited: false,
    isPendingReset: false,
    isHidden: false,
    ...overrides,
  };
}

function states(overrides: Partial<t.StorageFieldStates> = {}): t.StorageFieldStates {
  return {
    primary: state({ effective: 'local', value: 'local' }),
    default: state(),
    avatar: state(),
    image: state(),
    document: state(),
    skills: state(),
    ...overrides,
  };
}

describe('resolveStorage', () => {
  it('falls back like getFileStrategy: type, then default, then fileStrategy, then local', () => {
    expect(resolveStorage(states())).toEqual({
      primary: 'local',
      default: 'local',
      avatar: 'local',
      image: 'local',
      document: 'local',
      skills: undefined,
    });
    const resolved = resolveStorage(
      states({
        primary: state({ effective: 's3', value: 's3', source: 'yaml', isConfigured: true }),
        avatar: state({ value: 'local', isEdited: true }),
      }),
    );
    expect(resolved).toMatchObject({ primary: 's3', default: 's3', avatar: 'local', image: 's3' });
    expect([...backendsInUse(resolved)].sort()).toEqual(['local', 's3']);
  });

  it('lets fileStrategies.default win over fileStrategy for every type', () => {
    const resolved = resolveStorage(
      states({ default: state({ effective: 'azure_blob', value: 'azure_blob', source: 'yaml' }) }),
    );
    expect(resolved).toMatchObject({
      primary: 'local',
      default: 'azure_blob',
      document: 'azure_blob',
    });
  });

  it('reads a pending revert as the value beneath', () => {
    const avatar = state({
      value: 'local',
      effective: 's3',
      isOverride: true,
      isEdited: true,
      isPendingReset: true,
      revertTarget: { value: 'firebase', source: 'yaml' },
    });
    expect(ownValue(avatar)).toBeUndefined();
    expect(lowerValue(avatar)).toBe('firebase');
    expect(resolveStorage(states({ avatar })).avatar).toBe('firebase');
  });
});

describe('isCloudFrontReady', () => {
  it('needs a librechat.yaml cloudfront domain and a YAML strategy that uses it', () => {
    expect(isCloudFrontReady(null)).toBe(false);
    expect(isCloudFrontReady({ cloudfront: { domain: 'https://cdn.example.com' } })).toBe(false);
    expect(
      isCloudFrontReady({ fileStrategy: 'cloudfront', cloudfront: { domain: 'https://cdn' } }),
    ).toBe(true);
    expect(
      isCloudFrontReady({
        fileStrategies: { image: 'cloudfront' },
        cloudfront: { domain: 'https://cdn' },
      }),
    ).toBe(true);
    expect(isCloudFrontReady({ fileStrategy: 'cloudfront', cloudfront: {} })).toBe(false);
  });
});
