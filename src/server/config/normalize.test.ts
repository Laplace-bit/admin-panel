import { describe, expect, it } from 'vitest';
import type * as t from '@/types';
import { normalizeAppServiceKeys, normalizeEndpointValue } from './normalize';

/** An `azureOpenAI` block as LibreChat's `azureConfigSetup` returns it. */
const processedAzure = {
  errors: [],
  isValid: true,
  groupMap: {
    eastus: {
      apiKey: '${EASTUS_API_KEY}',
      instanceName: 'librechat-eastus',
      version: '2024-02-15-preview',
      models: { 'gpt-4.1': { deploymentName: 'gpt-4.1' } },
      serverless: false,
      assistants: true,
    },
    foundry: { apiKey: 'sk-literal', baseURL: 'https://x/models', serverless: true, models: {} },
  },
  modelNames: ['gpt-4.1'],
  modelGroupMap: { 'gpt-4.1': { group: 'eastus' } },
  assistantModels: ['gpt-4.1'],
  assistantGroups: ['eastus'],
  serverless: false,
  instanceName: '',
  deploymentName: '',
  streamRate: 25,
  assistants: true,
};

describe('normalizeEndpointValue', () => {
  it('drops every key Azure setup derives, assistantGroups included', () => {
    const normalized = normalizeEndpointValue(processedAzure);
    expect(Object.keys(normalized as object).sort()).toEqual([
      'assistants',
      'groups',
      'streamRate',
    ]);
  });

  it('rebuilds groups from the live groupMap, keeping dotted model names', () => {
    const normalized = normalizeEndpointValue(processedAzure) as { groups: object[] };
    expect(normalized.groups).toEqual([
      {
        group: 'eastus',
        apiKey: '${EASTUS_API_KEY}',
        instanceName: 'librechat-eastus',
        version: '2024-02-15-preview',
        models: { 'gpt-4.1': { deploymentName: 'gpt-4.1' } },
        serverless: false,
        assistants: true,
      },
      {
        group: 'foundry',
        apiKey: 'sk-literal',
        baseURL: 'https://x/models',
        serverless: true,
        models: {},
      },
    ]);
  });

  it('shows the live groups over a stored override LibreChat does not apply (D13)', () => {
    const merged = { ...processedAzure, groups: [{ group: 'stale', apiKey: 'x', models: {} }] };
    const normalized = normalizeEndpointValue(merged) as { groups: Array<{ group: string }> };
    expect(normalized.groups.map((group) => group.group)).toEqual(['eastus', 'foundry']);
  });

  it("drops the Anthropic block's derived vertexConfig and keeps vertex", () => {
    const anthropic = {
      vertex: { enabled: true, projectId: 'p' },
      vertexConfig: { modelNames: ['claude'] },
      streamRate: 30,
    };
    expect(normalizeEndpointValue(anthropic, 'anthropic')).toEqual({
      vertex: { enabled: true, projectId: 'p' },
      streamRate: 30,
    });
  });

  it('leaves other values unchanged', () => {
    const openAI = { titleModel: 'gpt-5-mini' };
    expect(normalizeEndpointValue(openAI, 'openAI')).toBe(openAI);
    expect(normalizeEndpointValue(['a'])).toEqual(['a']);
    expect(normalizeEndpointValue(null)).toBeNull();
  });
});

describe('normalizeAppServiceKeys', () => {
  it('normalizes every endpoint block by its key', () => {
    const result = normalizeAppServiceKeys({
      endpoints: {
        azureOpenAI: processedAzure,
        anthropic: { vertexConfig: {}, models: ['a'] },
      },
    });
    const endpoints = result.endpoints as Record<string, t.ConfigRecord>;
    expect(endpoints.azureOpenAI.groupMap).toBeUndefined();
    expect(endpoints.anthropic).toEqual({ models: ['a'] });
  });
});
