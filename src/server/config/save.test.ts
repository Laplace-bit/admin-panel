import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as t from '@/types';
import { createFakeAdminApi } from '@/test/admin';

const yaml: t.ConfigRecord = {
  balance: { enabled: true, startBalance: 1000000, refillAmount: 1000000 },
  endpoints: {
    custom: [
      {
        name: 'Moonshot',
        apiKey: '${MOONSHOT_API_KEY}',
        baseURL: 'https://api.moonshot.ai/v1',
        models: { default: ['kimi-k2'], fetch: false },
      },
      {
        name: 'GPT',
        apiKey: '${OPENAI_API_KEY}',
        baseURL: 'https://api.openai.com/v1',
        models: { default: ['gpt-4o'] },
      },
      { name: 'Zai 2', apiKey: 'user_provided', baseURL: 'https://zai.example.com' },
    ],
  },
  mcpServers: {
    cloudflare: { type: 'streamable-http', url: 'https://mcp.cloudflare.com/mcp' },
  },
};

const api = vi.hoisted(() => ({
  current: undefined as ReturnType<typeof createFakeAdminApi> | undefined,
}));

vi.mock('../utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit) => api.current!.fetch(path, init),
  extractApiError: async (_response: unknown, message: string) => {
    throw new Error(message);
  },
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({ handler: (fn: (...args: unknown[]) => unknown) => fn }),
    handler: (fn: (...args: unknown[]) => unknown) => fn,
  }),
}));

vi.mock('@tanstack/react-query', () => ({ queryOptions: (opts: unknown) => opts }));

import { applyConfigChanges } from './save';

const base: t.WriteTargetRef = { type: 'base' };
const customEntries = (yaml.endpoints as t.ConfigRecord).custom as t.ConfigRecord[];
const models = { default: ['m'] };

function upsert(
  key: string,
  identity: string | null,
  value: t.ConfigValue,
  baseline?: t.ConfigValue,
): t.ConfigChange {
  return { op: 'upsertEntry', path: 'endpoints.custom', key, identity, value, baseline };
}

beforeEach(() => {
  api.current = createFakeAdminApi(yaml);
});

describe('applyConfigChanges — keyed collections (SV-1)', () => {
  it('stores exactly one partial entry when one Moonshot field changes', async () => {
    const moonshot = customEntries[0];
    const result = await applyConfigChanges(base, [
      upsert(
        'Moonshot',
        'Moonshot',
        { ...moonshot, baseURL: 'https://api.moonshot.cn/v1' },
        moonshot,
      ),
    ]);
    expect(result).toMatchObject({ applied: 1, issues: [], failed: [] });
    expect(api.current!.stored()).toEqual({
      endpoints: { custom: [{ name: 'Moonshot', baseURL: 'https://api.moonshot.cn/v1' }] },
    });
  });

  it('refuses to delete or rename a YAML endpoint and writes nothing', async () => {
    const result = await applyConfigChanges(base, [
      { op: 'removeEntry', path: 'endpoints.custom', key: 'Zai 2', identity: 'Zai 2' },
      upsert('Zai', 'Zai 2', { ...customEntries[2], name: 'Zai' }, customEntries[2]),
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'YAML_ENTRY_IMMUTABLE',
      'YAML_ENTRY_IMMUTABLE',
    ]);
    expect(result.applied).toBe(0);
    expect(api.current!.writes()).toEqual([]);
  });

  it('deletes and renames DB-only endpoints, keeping the other stored entries', async () => {
    const adminA = { name: 'AdminA', apiKey: 'user_provided', baseURL: 'https://a', models };
    const adminB = { name: 'AdminB', apiKey: 'user_provided', baseURL: 'https://b', models };
    api.current!.seed('role/__base__', {
      endpoints: { custom: [adminA, adminB, { name: 'Moonshot', titleModel: 'kimi' }] },
    });
    await applyConfigChanges(base, [
      { op: 'removeEntry', path: 'endpoints.custom', key: 'AdminA', identity: 'AdminA' },
      upsert('AdminC', 'AdminB', { ...adminB, name: 'AdminC' }, adminB),
    ]);
    expect(api.current!.stored()).toEqual({
      endpoints: {
        custom: [
          { ...adminB, name: 'AdminC' },
          { name: 'Moonshot', titleModel: 'kimi' },
        ],
      },
    });
  });

  it('fails with a conflict instead of editing another entry after a concurrent delete', async () => {
    const adminA = { name: 'AdminA', apiKey: 'user_provided', baseURL: 'https://a', models };
    api.current!.seed('role/__base__', {
      endpoints: {
        custom: [{ name: 'AdminB', apiKey: 'user_provided', baseURL: 'https://b', models }],
      },
    });
    const result = await applyConfigChanges(base, [
      upsert('AdminA', 'AdminA', { ...adminA, baseURL: 'https://a2' }, adminA),
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual(['ENTRY_NOT_FOUND']);
    expect(api.current!.writes()).toEqual([]);
  });

  it('requires a new key to rename an endpoint with a stored secret (SV-10)', async () => {
    api.current!.seed('role/__base__', {
      endpoints: {
        custom: [{ name: 'Vault', apiKey: 'enc:sk-secret', baseURL: 'https://v', models }],
      },
    });
    const baseline = { name: 'Vault', baseURL: 'https://v', apiKeyPreview: 'sk-...', models };
    const blocked = await applyConfigChanges(base, [
      upsert('Vault 2', 'Vault', { ...baseline, name: 'Vault 2' }, baseline),
    ]);
    expect(blocked.issues.map((issue) => issue.code)).toEqual(['SECRET_REQUIRED_FOR_RENAME']);
    const allowed = await applyConfigChanges(base, [
      upsert('Vault 2', 'Vault', { ...baseline, name: 'Vault 2', apiKey: 'sk-new' }, baseline),
    ]);
    expect(allowed.issues).toEqual([]);
    expect(api.current!.stored()).toEqual({
      endpoints: {
        custom: [{ name: 'Vault 2', apiKey: 'enc:sk-new', baseURL: 'https://v', models }],
      },
    });
  });

  it('keeps a stored secret by name when another field of the entry changes', async () => {
    api.current!.seed('role/__base__', {
      endpoints: {
        custom: [{ name: 'Vault', apiKey: 'enc:sk-secret', baseURL: 'https://v', models }],
      },
    });
    const baseline = { name: 'Vault', baseURL: 'https://v', apiKeyPreview: 'sk-...', models };
    await applyConfigChanges(base, [
      upsert('Vault', 'Vault', { ...baseline, baseURL: 'https://v2' }, baseline),
    ]);
    expect(api.current!.stored()).toEqual({
      endpoints: {
        custom: [{ name: 'Vault', apiKey: 'enc:sk-secret', baseURL: 'https://v2', models }],
      },
    });
  });
});

describe('applyConfigChanges — validated, ordered, compensated (SV-2)', () => {
  it('writes nothing when a rename comes with an invalid title', async () => {
    api.current!.seed('role/__base__', {
      mcpServers: {
        renamer: { type: 'sse', url: 'https://sse.example.com/sse', title: 'Renamer' },
      },
    });
    const result = await applyConfigChanges(base, [
      { op: 'reset', path: 'mcpServers.renamer' },
      { op: 'set', path: 'mcpServers.final-server.type', value: 'sse' },
      { op: 'set', path: 'mcpServers.final-server.url', value: 'https://sse.example.com/sse' },
      { op: 'set', path: 'mcpServers.final-server.title', value: 'Bad_Title!' },
    ]);
    expect(result.issues.map((issue) => issue.path)).toContain('mcpServers.final-server.title');
    expect(api.current!.writes()).toEqual([]);
    expect(api.current!.stored()).toHaveProperty('mcpServers.renamer');
  });

  it('writes the new entry before deleting the old one', async () => {
    api.current!.seed('role/__base__', {
      mcpServers: { renamer: { type: 'sse', url: 'https://sse.example.com/sse' } },
    });
    await applyConfigChanges(base, [
      { op: 'reset', path: 'mcpServers.renamer' },
      { op: 'set', path: 'mcpServers.renamed.type', value: 'sse' },
      { op: 'set', path: 'mcpServers.renamed.url', value: 'https://sse.example.com/sse' },
    ]);
    expect(api.current!.writes().map((r) => r.method)).toEqual(['PATCH', 'DELETE']);
    expect(api.current!.stored()).toEqual({
      mcpServers: { renamed: { type: 'sse', url: 'https://sse.example.com/sse' } },
    });
  });

  it('rolls the written sets back when a later reset fails', async () => {
    const before = { balance: { startBalance: 5 }, interface: { customWelcome: 'hi' } };
    api.current!.seed('role/__base__', before);
    let failed = false;
    api.current!.setOverride((request) => {
      if (request.method !== 'DELETE' || failed) return undefined;
      failed = true;
      return { status: 500, body: { error: 'boom' } };
    });
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.refillAmount', value: 7 },
      { op: 'reset', path: 'interface.customWelcome' },
    ]);
    expect(result).toMatchObject({
      applied: 0,
      compensated: true,
      failed: [{ code: 'WRITE_FAILED', message: 'boom' }],
    });
    expect(api.current!.stored()).toEqual(before);
  });

  it('reports a save LibreChat refuses until the admin accepts its terms, with where to accept them', async () => {
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? {
            status: 403,
            body: {
              code: 'terms_not_accepted',
              message: 'Terms of service must be accepted before using this feature',
            },
          }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'memory.tokenLimit', value: 5000 },
    ]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        path: '',
        code: 'TERMS_NOT_ACCEPTED',
        params: { url: expect.any(String) },
      }),
    ]);
  });

  it('keeps the admin API message of a refused write that names no issues', async () => {
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? { status: 409, body: { message: 'Config was changed by someone else' } }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'memory.tokenLimit', value: 5000 },
    ]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        code: 'WRITE_FAILED',
        message: 'Config was changed by someone else',
      }),
    ]);
  });

  it('maps backend issues on the sent array back to the entry name (SV-3)', async () => {
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? {
            status: 400,
            body: {
              error: 'Invalid config override',
              code: 'CONFIG_OVERRIDE_INVALID',
              issues: [{ path: 'endpoints.custom.0.titleMethod', code: 'invalid_enum_value' }],
            },
          }
        : undefined,
    );
    const gpt = customEntries[1];
    const result = await applyConfigChanges(base, [
      upsert('GPT', 'GPT', { ...gpt, titleModel: 'gpt-4o-mini' }, gpt),
    ]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        path: 'endpoints.custom.0.titleMethod',
        code: 'invalid_enum_value',
        entryIdentity: 'GPT',
        entryPath: 'titleMethod',
      }),
    ]);
    expect(api.current!.stored()).toBeUndefined();
  });

  it('words a backend issue it gets no parameters for without placeholders', async () => {
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? {
            status: 400,
            body: {
              error: 'Invalid config override',
              code: 'CONFIG_OVERRIDE_INVALID',
              issues: [{ path: 'balance.startBalance', code: 'too_small' }],
            },
          }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 5 },
    ]);
    expect(result.failed).toEqual([
      { path: 'balance.startBalance', code: 'too_small', message: 'is too small' },
    ]);
  });

  it('blocks provider: openai with the field and entry named', async () => {
    const gpt = customEntries[1];
    const result = await applyConfigChanges(base, [
      upsert('GPT', 'GPT', { ...gpt, provider: 'openai' }, gpt),
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'invalid_literal',
        message: 'must be "anthropic"',
        entryIdentity: 'GPT',
        entryPath: 'provider',
      }),
    ]);
  });
});

describe('applyConfigChanges — clear/reset and verification (SV-4, SV-5, SV-7)', () => {
  it('sends nothing for clearing a librechat.yaml value with no override', async () => {
    const result = await applyConfigChanges(base, [{ op: 'reset', path: 'balance.refillAmount' }]);
    expect(result.skipped).toEqual([{ fieldPath: 'balance.refillAmount', reason: 'yamlValue' }]);
    expect(api.current!.writes()).toEqual([]);
  });

  it('removes the emptied section instead of leaving {}', async () => {
    api.current!.seed('role/__base__', { balance: { startBalance: 5 } });
    await applyConfigChanges(base, [{ op: 'reset', path: 'balance.startBalance' }]);
    expect(api.current!.writes()).toMatchObject([
      { method: 'DELETE', path: expect.stringContaining('fieldPath=balance') },
    ]);
    expect(api.current!.writes()[0].path).not.toContain('startBalance');
    expect(api.current!.stored()).toEqual({});
  });

  it('keeps a stored tombstone when removing an override would empty its section (BE-11)', async () => {
    api.current!.seed('role/__base__', { balance: { startBalance: 5 } }, ['balance.refillAmount']);
    await applyConfigChanges(base, [{ op: 'reset', path: 'balance.startBalance' }]);
    expect(api.current!.writes()).toMatchObject([
      { method: 'DELETE', path: expect.stringContaining('fieldPath=balance.startBalance') },
    ]);
    expect(api.current!.tombstones()).toEqual(['balance.refillAmount']);
  });

  it('reports a value LibreChat dropped as not stored', async () => {
    api.current!.stripSection('speech');
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 9 },
      { op: 'set', path: 'speech.speechTab.advancedMode', value: true },
    ]);
    expect(result.skipped).toContainEqual({
      fieldPath: 'speech.speechTab.advancedMode',
      reason: 'notStored',
    });
    expect(result.applied).toBe(1);
  });

  it('reports YAML keys a record write cannot remove', async () => {
    const yamlWithHeaders = {
      ...yaml,
      mcpServers: {
        github: { type: 'streamable-http', url: 'https://gh', headers: { Authorization: 'x' } },
      },
    };
    api.current = createFakeAdminApi(yamlWithHeaders);
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'mcpServers.github.headers', value: { 'X-Other': 'abc' } },
    ]);
    expect(result.warnings).toEqual([
      { path: 'mcpServers.github.headers', warning: 'yamlOnly', keys: ['Authorization'] },
    ]);
    expect(result.skipped).toContainEqual({
      fieldPath: 'mcpServers.github.headers.Authorization',
      reason: 'yamlMerged',
    });
  });
});

describe('applyConfigChanges — profiles (SV-9)', () => {
  const scope: t.WriteTargetRef = {
    type: 'scope',
    scope: { principalType: 'group' as t.ConfigScope['principalType'], principalId: 'eng' },
  };

  it('removing a profile override of an inherited server only deletes the override', async () => {
    api.current!.seed('group/eng', {
      mcpServers: { cloudflare: { url: 'https://eng-cloudflare.example.com/mcp' } },
    });
    await applyConfigChanges(scope, [{ op: 'reset', path: 'mcpServers.cloudflare' }]);
    expect(api.current!.writes().map((r) => r.method)).toEqual(['DELETE']);
    expect(api.current!.tombstones('group/eng')).toEqual([]);
  });

  it('hides an inherited value only on an explicit tombstone', async () => {
    api.current!.seed('group/eng', {});
    await applyConfigChanges(scope, [{ op: 'tombstone', path: 'mcpServers.cloudflare' }]);
    expect(api.current!.tombstones('group/eng')).toEqual(['mcpServers.cloudflare']);
  });

  it('diffs a profile entry edit against the inherited base entry', async () => {
    const moonshot = customEntries[0];
    api.current!.seed('group/eng', {});
    await applyConfigChanges(scope, [
      upsert('Moonshot', 'Moonshot', { ...moonshot, titleModel: 'kimi-latest' }, moonshot),
    ]);
    expect(api.current!.stored('group/eng')).toEqual({
      endpoints: { custom: [{ name: 'Moonshot', titleModel: 'kimi-latest' }] },
    });
  });
});

describe('applyConfigChanges — switching a union away from a librechat.yaml key (WS13)', () => {
  const memoryYaml: t.ConfigRecord = { ...yaml, memory: { agent: { id: 'agent_yaml' } } };

  /** LibreChat validates a PATCH against librechat.yaml minus the stored tombstones (`union_dropped_key`). */
  function rejectInlineAgentWhileIdShows() {
    api.current!.setOverride((request) => {
      const writesInline = request.body?.entries?.some((entry) =>
        entry.fieldPath.startsWith('memory.agent.provider'),
      );
      if (request.method !== 'PATCH' || !writesInline) return undefined;
      if (api.current!.tombstones().includes('memory.agent.id')) return undefined;
      return {
        status: 400,
        body: {
          code: 'CONFIG_OVERRIDE_INVALID',
          issues: [{ path: 'memory.agent.provider', code: 'union_dropped_key' }],
        },
      };
    });
  }

  it('writes the tombstone of the YAML agent ID before the inline provider and model', async () => {
    api.current = createFakeAdminApi(memoryYaml);
    rejectInlineAgentWhileIdShows();
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'memory.agent.provider', value: 'openAI' },
      { op: 'set', path: 'memory.agent.model', value: 'gpt-4o-mini' },
      { op: 'tombstone', path: 'memory.agent.id' },
    ]);
    expect(result).toMatchObject({ failed: [], issues: [] });
    expect(api.current.writes().map((request) => request.method)).toEqual(['POST', 'PATCH']);
    expect(api.current.stored()).toEqual({
      memory: { agent: { provider: 'openAI', model: 'gpt-4o-mini' } },
    });
    expect(api.current.tombstones()).toEqual(['memory.agent.id']);
  });

  it('validates the result without the hidden key, so an incomplete inline agent is blocked', async () => {
    api.current = createFakeAdminApi(memoryYaml);
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'memory.agent.provider', value: 'openAI' },
      { op: 'tombstone', path: 'memory.agent.id' },
    ]);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((issue) => issue.path.startsWith('memory.agent'))).toBe(true);
    expect(api.current.writes()).toEqual([]);
  });
});

describe('applyConfigChanges — the server contract (GET /api/admin/config/meta)', () => {
  const profiles = { 'us.anthropic.claude-sonnet-4-6': 'arn:aws:bedrock:us:1:profile/x' };

  it('blocks a dotted record key on a server without the contract (it would drop the key)', async () => {
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'endpoints.bedrock.inferenceProfiles', value: profiles },
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual(['UNSAFE_KEY']);
    expect(api.current!.writes()).toEqual([]);
    expect(api.current!.requests.map((request) => request.path)).toContain(
      '/api/admin/config/meta',
    );
  });

  it('writes a dotted record whole when the server keeps dotted keys', async () => {
    api.current!.reportMeta({ features: { dottedKeys: true } });
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'endpoints.bedrock.inferenceProfiles', value: profiles },
    ]);
    expect(result).toMatchObject({ issues: [], failed: [], applied: 1, skipped: [] });
    expect(api.current!.writes()).toMatchObject([
      {
        method: 'PATCH',
        body: { entries: [{ fieldPath: 'endpoints.bedrock.inferenceProfiles', value: profiles }] },
      },
    ]);
  });

  it('still refuses a $ key when the server keeps dotted keys', async () => {
    api.current!.reportMeta({ features: { dottedKeys: true } });
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'endpoints.bedrock.inferenceProfiles', value: { $where: 'x' } },
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual(['RESERVED_KEY']);
    expect(api.current!.writes()).toEqual([]);
  });

  it("splits sets into PATCHes of the server's maxPatchEntries", async () => {
    api.current!.reportMeta({ limits: { maxPatchEntries: 2 } });
    await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 5 },
      { op: 'set', path: 'balance.refillAmount', value: 6 },
      { op: 'set', path: 'balance.refillIntervalValue', value: 7 },
    ]);
    expect(api.current!.writes().map((request) => request.body?.entries?.length)).toEqual([2, 1]);
  });
});

describe('applyConfigChanges — write reports, structured issues and codes', () => {
  const skippedPart = {
    path: 'interface.prompts',
    segments: ['interface', 'prompts'],
    reason: 'interface_permission',
  };
  const skippedWhole = {
    path: 'balance.refillAmount',
    segments: ['balance', 'refillAmount'],
    reason: 'deployment_only_path',
  };

  it('reports what the server did not store, counting only whole changes as not applied', async () => {
    api.current!.reportMeta({ features: { writeReport: true } });
    api.current!.reportWrites(() => ({ applied: [], skipped: [skippedWhole, skippedPart] }));
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 5 },
      { op: 'set', path: 'balance.refillAmount', value: 6 },
    ]);
    expect(result).toMatchObject({ issues: [], failed: [], applied: 1 });
    expect(result.skipped).toEqual([{ fieldPath: 'balance.refillAmount', reason: 'yamlOnly' }]);
    expect(result.reported).toEqual([{ fieldPath: 'interface.prompts', reason: 'permission' }]);
  });

  it('leaves the report alone on a server without writeReport', async () => {
    api.current!.reportWrites(() => ({ skipped: [skippedWhole] }));
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.refillAmount', value: 6 },
    ]);
    expect(result).toMatchObject({ applied: 1, skipped: [] });
  });

  it('reports a whole PATCH the server skipped, without a second not-stored finding', async () => {
    api.current!.reportMeta({ features: { writeReport: true } });
    api.current!.stripSection('balance');
    api.current!.reportWrites((request) =>
      request.method === 'PATCH' ? { applied: [], skipped: [skippedWhole] } : {},
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.refillAmount', value: 6 },
    ]);
    expect(result).toMatchObject({ applied: 0 });
    expect(result.skipped).toEqual([{ fieldPath: 'balance.refillAmount', reason: 'yamlOnly' }]);
  });

  it('reports a tombstone the server skipped', async () => {
    api.current!.reportMeta({ features: { writeReport: true } });
    api.current!.reportWrites((request) =>
      request.path.endsWith('/tombstone')
        ? { skipped: [{ path: 'balance.refillAmount', reason: 'deployment_only_path' }] }
        : {},
    );
    const result = await applyConfigChanges(base, [
      { op: 'tombstone', path: 'balance.refillAmount' },
    ]);
    expect(result.skipped).toEqual([{ fieldPath: 'balance.refillAmount', reason: 'yamlOnly' }]);
    expect(result.applied).toBe(0);
  });

  it('reports a credential the merge leaves out once the server rebinds credentials', async () => {
    const ignored = [
      {
        path: 'endpoints.custom.Moonshot.apiKey',
        segments: ['endpoints', 'custom', 'Moonshot', 'apiKey'],
        reason: 'secret_rebinding',
      },
    ];
    api.current!.reportWrites(() => ({ ignored }));
    const moonshot = customEntries[0];
    const change = upsert(
      'Moonshot',
      'Moonshot',
      { ...moonshot, baseURL: 'https://proxy.example.com/v1' },
      moonshot,
    );
    expect(await applyConfigChanges(base, [change])).toMatchObject({ skipped: [], reported: [] });
    api.current = createFakeAdminApi(yaml);
    api.current.reportMeta({ features: { secretRebinding: true } });
    api.current.reportWrites(() => ({ ignored }));
    const result = await applyConfigChanges(base, [change]);
    expect(result).toMatchObject({ applied: 1, failed: [], skipped: [] });
    expect(result.reported).toEqual([
      { fieldPath: 'endpoints.custom.Moonshot.apiKey', reason: 'secretRebinding' },
    ]);
    const unrelated = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 5 },
    ]);
    expect(unrelated).toMatchObject({ applied: 1, skipped: [], reported: [] });
  });

  it('notes a dropped credential once, apart from the changes, however many PATCHes repeat it', async () => {
    api.current!.reportMeta({
      features: { secretRebinding: true },
      limits: { maxPatchEntries: 1 },
    });
    api.current!.reportWrites(() => ({
      ignored: [
        {
          path: 'endpoints.custom.Moonshot.apiKey',
          segments: ['endpoints', 'custom', 'Moonshot', 'apiKey'],
          reason: 'secret_rebinding',
        },
      ],
    }));
    const moonshot = customEntries[0];
    const result = await applyConfigChanges(base, [
      upsert('Moonshot', 'Moonshot', { ...moonshot, titleModel: 'kimi-k2' }, moonshot),
      { op: 'set', path: 'balance.startBalance', value: 5 },
    ]);
    expect(api.current!.writes()).toHaveLength(2);
    expect(result).toMatchObject({ applied: 2, failed: [], skipped: [] });
    expect(result.reported).toEqual([
      { fieldPath: 'endpoints.custom.Moonshot.apiKey', reason: 'secretRebinding' },
    ]);
  });

  it("does not repeat a dropped credential on a later save of another endpoint's settings", async () => {
    api.current!.reportMeta({ features: { secretRebinding: true } });
    api.current!.reportWrites(() => ({
      ignored: [
        {
          path: 'endpoints.custom.Moonshot.apiKey',
          segments: ['endpoints', 'custom', 'Moonshot', 'apiKey'],
          reason: 'secret_rebinding',
        },
      ],
    }));
    const [moonshot, gpt] = customEntries;
    const title = await applyConfigChanges(base, [
      { op: 'set', path: 'endpoints.openAI.titleModel', value: 'gpt-5-nano' },
    ]);
    expect(title).toMatchObject({ applied: 1, failed: [], skipped: [], reported: [] });
    const other = await applyConfigChanges(base, [
      upsert('GPT', 'GPT', { ...gpt, titleModel: 'gpt-4o-mini' }, gpt),
    ]);
    expect(other).toMatchObject({ applied: 1, failed: [], skipped: [], reported: [] });
    expect(api.current!.writes().at(-1)).toMatchObject({
      body: { entries: [{ fieldPath: 'endpoints.custom' }] },
    });
    const same = await applyConfigChanges(base, [
      upsert('Moonshot', 'Moonshot', { ...moonshot, titleModel: 'kimi-k2' }, moonshot),
    ]);
    expect(same.reported).toEqual([
      { fieldPath: 'endpoints.custom.Moonshot.apiKey', reason: 'secretRebinding' },
    ]);
  });

  it('words a backend issue by its params on a server with issueParams', async () => {
    const issue = {
      path: 'balance.startBalance',
      segments: ['balance', 'startBalance'],
      code: 'too_small',
      params: { minimum: 1, inclusive: true, exact: false, type: 'number' },
    };
    const refuse = (request: { method: string }) =>
      request.method === 'PATCH'
        ? { status: 400, body: { code: 'CONFIG_OVERRIDE_INVALID', issues: [issue] } }
        : undefined;
    api.current!.setOverride(refuse);
    const before = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 0 },
    ]);
    expect(before.failed).toEqual([
      { path: 'balance.startBalance', code: 'too_small', message: 'is too small' },
    ]);
    api.current!.reportMeta({ features: { issueParams: true } });
    const after = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 0 },
    ]);
    expect(after.failed).toEqual([
      {
        path: 'balance.startBalance',
        code: 'too_small',
        message: 'must be at least 1',
        params: { minimum: 1 },
      },
    ]);
  });

  it('locates an issue by its segments: a dotted record key stays one key', async () => {
    const profiles = { 'us.anthropic.claude-sonnet-4-6': 'arn' };
    api.current!.reportMeta({ features: { dottedKeys: true, issueParams: true } });
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? {
            status: 400,
            body: {
              code: 'CONFIG_OVERRIDE_INVALID',
              issues: [
                {
                  path: 'endpoints.bedrock.inferenceProfiles.us.anthropic.claude-sonnet-4-6',
                  segments: [
                    'endpoints',
                    'bedrock',
                    'inferenceProfiles',
                    'us.anthropic.claude-sonnet-4-6',
                  ],
                  code: 'too_small',
                  params: { minimum: 20, inclusive: true, exact: false, type: 'string' },
                },
              ],
            },
          }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'endpoints.bedrock.inferenceProfiles', value: profiles },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.failed).toEqual([
      {
        path: 'endpoints.bedrock.inferenceProfiles',
        code: 'too_small_length',
        message: 'must be at least 20 characters',
        params: { minimum: 20 },
      },
    ]);
  });

  it('maps an entry issue by segments to the entry name', async () => {
    api.current!.reportMeta({ features: { dottedKeys: true } });
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? {
            status: 400,
            body: {
              code: 'CONFIG_OVERRIDE_INVALID',
              issues: [
                {
                  path: 'endpoints.custom.0.headers.x-portkey.config',
                  segments: ['endpoints', 'custom', '0', 'headers', 'x-portkey.config'],
                  code: 'invalid_type',
                },
              ],
            },
          }
        : undefined,
    );
    const gpt = customEntries[1];
    const result = await applyConfigChanges(base, [
      upsert('GPT', 'GPT', { ...gpt, headers: { 'x-portkey.config': 'x' } }, gpt),
    ]);
    expect(result.failed).toEqual([
      expect.objectContaining({ entryIdentity: 'GPT', entryPath: 'headers' }),
    ]);
  });

  it("words a refused write by the admin API's code", async () => {
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? {
            status: 400,
            body: {
              error: 'Process-backed MCP servers are configured in librechat.yaml',
              code: 'PROCESS_MCP_SERVER_OVERRIDE',
            },
          }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'mcpServers.cloudflare.title', value: 'Cloudflare' },
    ]);
    expect(result.failed).toEqual([
      {
        path: 'mcpServers.cloudflare.title',
        code: 'WRITE_FAILED',
        message:
          'This MCP server runs a local process defined in librechat.yaml, so LibreChat applies no overrides to it.',
      },
    ]);
  });
});
