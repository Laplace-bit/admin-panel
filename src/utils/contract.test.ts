import { describe, it, expect } from 'vitest';
import {
  CONFIG_FEATURE_FLAGS,
  BUNDLED_CONFIG_RULES,
  BUNDLED_CONFIG_LIMITS,
  BUNDLED_CONFIG_CONTRACT,
} from '@/constants';
import { resolveConfigContract } from './contract';

describe('resolveConfigContract', () => {
  it('is the bundled contract, every feature off, for a server without the meta route', () => {
    const contract = resolveConfigContract(null);
    expect(contract).toBe(BUNDLED_CONFIG_CONTRACT);
    expect(contract.source).toBe('bundled');
    expect(Object.values(contract.features).every((on) => on === false)).toBe(true);
    expect(Object.keys(contract.features).sort()).toEqual([...CONFIG_FEATURE_FLAGS].sort());
  });

  it('turns on exactly the flags the server reports as true', () => {
    const contract = resolveConfigContract({
      features: { dottedKeys: true, webSearchStoredKeys: false, someFutureFlag: true },
    });
    expect(contract.source).toBe('server');
    expect(contract.features.dottedKeys).toBe(true);
    expect(contract.features.webSearchStoredKeys).toBe(false);
    expect(contract.features.changesBatch).toBe(false);
    expect(contract.features).not.toHaveProperty('someFutureFlag');
  });

  it('fills limits and rules the server leaves out from the bundled ones', () => {
    const contract = resolveConfigContract({
      limits: { maxPatchEntries: 50, maxChangeOps: undefined },
      rules: {
        titleResolution: 'field',
        baseOnlyPaths: ['endpoints.agents.pullRequests.provider'],
      },
    });
    expect(contract.limits).toEqual({ ...BUNDLED_CONFIG_LIMITS, maxPatchEntries: 50 });
    expect(contract.rules).toEqual({
      ...BUNDLED_CONFIG_RULES,
      titleResolution: 'field',
      baseOnlyPaths: ['endpoints.agents.pullRequests.provider'],
    });
  });

  it('reports versions only when all three are given', () => {
    const versions = { librechat: 'v0.8.9', dataProvider: '0.8.528', configSchema: '1.3.18' };
    expect(resolveConfigContract({ versions }).versions).toEqual(versions);
    expect(resolveConfigContract({ versions: { librechat: 'v0.8.9' } }).versions).toBeUndefined();
  });
});

describe('BUNDLED_CONFIG_RULES', () => {
  it('mirrors what LibreChat enforced before it reported its rules', () => {
    expect(BUNDLED_CONFIG_RULES.arrayMergeKeys).toEqual({ 'endpoints.custom': 'name' });
    expect(BUNDLED_CONFIG_RULES.arraySecretFields).toEqual([
      {
        arrayPath: 'endpoints.custom',
        secretKey: 'apiKey',
        previewKey: 'apiKeyPreview',
        identityKey: 'name',
      },
    ]);
    expect(BUNDLED_CONFIG_RULES.overrideKeyMap).toEqual({
      interface: 'interfaceConfig',
      turnstile: 'turnstileConfig',
      mcpServers: 'mcpConfig',
    });
    expect(BUNDLED_CONFIG_RULES.baseOnlySections).toEqual(
      expect.arrayContaining(['filters', 'mcpAppSandbox']),
    );
    expect(BUNDLED_CONFIG_RULES.recordSecretFields).toEqual([]);
    expect(BUNDLED_CONFIG_RULES.titleResolution).toBe('block');
    expect(BUNDLED_CONFIG_RULES.secretFields).toContainEqual({
      path: 'langfuse.secretKey',
      previewPath: 'langfuse.secretKeyPreview',
      allowEnvPlaceholder: false,
    });
  });
});
