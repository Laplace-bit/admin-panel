import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import {
  toBatchOps,
  verifyWrite,
  planConfigChanges,
  mergedBackChanges,
  parseIndexedArrayPath,
} from './changes';
import { validateEntry, validateSection, validateField } from './validation';
import { BUNDLED_CONFIG_FEATURES } from '@/constants';

const yaml: t.ConfigRecord = {
  balance: { enabled: true, startBalance: 1000000, refillAmount: 1000000 },
  endpoints: {
    custom: [
      {
        name: 'GPT',
        apiKey: '${OPENAI_KEY}',
        baseURL: 'https://api.openai.com/v1',
        models: { default: ['gpt-4o'] },
      },
      { name: 'Zai 2', apiKey: 'user_provided', baseURL: 'https://zai' },
    ],
  },
  mcpServers: {
    github: {
      type: 'streamable-http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: 'Bearer {{PAT_TOKEN}}' },
    },
  },
};

function snapshot(
  stored: t.ConfigRecord = {},
  lower: t.ConfigRecord = yaml,
  tombstones: string[] = [],
): t.WriteSnapshot {
  return { stored, tombstones, lower, lowerKind: 'yaml' };
}

describe('validateSection / validateEntry / validateField', () => {
  it('blocks agent recursion limits LibreChat runs fail on (0, negatives, fractions)', () => {
    const issues = (agents: t.ConfigRecord) =>
      validateSection('endpoints', { agents }).map((issue) => `${issue.path}:${issue.code}`);
    expect(issues({ recursionLimit: 0, maxRecursionLimit: -5 })).toEqual([
      'endpoints.agents.recursionLimit:too_small',
      'endpoints.agents.maxRecursionLimit:too_small',
    ]);
    expect(issues({ recursionLimit: 2.5 })).toEqual([
      'endpoints.agents.recursionLimit:invalid_type',
    ]);
    expect(issues({ recursionLimit: 75, maxRecursionLimit: 60 })).toEqual([]);
  });

  it('blocks a recursion limit of 0 in a save plan', () => {
    const plan = planConfigChanges(
      [{ op: 'set', path: 'endpoints.agents.recursionLimit', value: 0 }],
      snapshot(),
    );
    expect(plan.issues).toEqual([
      expect.objectContaining({ path: 'endpoints.agents.recursionLimit', code: 'too_small' }),
    ]);
  });

  it('catches cloudfront and turnstile refinements and required siblings', () => {
    expect(
      validateSection('cloudfront', { invalidateOnDelete: true }).map((i) => i.path),
    ).toContain('cloudfront.domain');
    expect(validateSection('turnstile', { options: { theme: 'auto' } })).toMatchObject([
      { path: 'turnstile.siteKey', code: 'required', message: 'is required' },
    ]);
  });

  it('maps entry issues to readable codes with the entry identity', () => {
    const issues = validateEntry(
      'endpoints.custom',
      {
        name: 'GPT',
        apiKey: 'k',
        baseURL: 'b',
        models: { default: ['m'] },
        provider: 'openai',
        streamRate: -5,
      },
      2,
      'GPT',
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'endpoints.custom.2.provider',
          code: 'invalid_literal',
          message: 'must be "anthropic"',
          entryIdentity: 'GPT',
          entryPath: 'provider',
        }),
        expect.objectContaining({
          path: 'endpoints.custom.2.streamRate',
          code: 'too_small',
          params: { minimum: 0 },
        }),
      ]),
    );
  });

  it('validates a single field', () => {
    expect(validateField('balance.startBalance', 'x')).toMatchObject([
      { code: 'invalid_type', params: { expected: 'a number' } },
    ]);
  });
});

describe('parseIndexedArrayPath', () => {
  it('recognizes items of array settings only', () => {
    expect(parseIndexedArrayPath('modelSpecs.list.2')).toEqual({
      arrayPath: 'modelSpecs.list',
      index: 2,
    });
    expect(parseIndexedArrayPath('mcpServers.2024')).toBeNull();
  });
});

describe('planConfigChanges', () => {
  it('turns entry ops into one write of the stored array (one partial entry)', () => {
    const baseline = (yaml.endpoints as t.ConfigRecord).custom as t.ConfigRecord[];
    const plan = planConfigChanges(
      [
        {
          op: 'upsertEntry',
          path: 'endpoints.custom',
          key: 'GPT',
          identity: 'GPT',
          baseline: baseline[0],
          value: { ...baseline[0], baseURL: 'https://proxy.example.com/v1' },
        },
      ],
      snapshot(),
    );
    expect(plan.issues).toEqual([]);
    expect(plan.sets).toEqual([
      {
        fieldPath: 'endpoints.custom',
        value: [{ name: 'GPT', baseURL: 'https://proxy.example.com/v1' }],
      },
    ]);
    expect(plan.effective).toBe(1);
    expect(plan.changed).toEqual(['endpoints.custom.GPT']);
  });

  it('names what it changes by path, and a keyed collection by the entries its changes touch', () => {
    const models = { default: ['m'] };
    const adminA = { name: 'AdminA', apiKey: 'user_provided', baseURL: 'https://a', models };
    const ollama = { ...adminA, name: 'Ollama', baseURL: 'http://ollama:11434/v1' };
    const plan = planConfigChanges(
      [
        { op: 'set', path: 'mcpServers.github.url', value: 'https://mcp.example.com/' },
        { op: 'reset', path: 'balance.refillAmount' },
        { op: 'tombstone', path: 'endpoints.openAI.titleModel' },
        {
          op: 'upsertEntry',
          path: 'endpoints.custom',
          key: 'Ollama',
          identity: null,
          value: ollama,
        },
        {
          op: 'upsertEntry',
          path: 'endpoints.custom',
          key: 'AdminB',
          identity: 'AdminA',
          value: { ...adminA, name: 'AdminB' },
        },
      ],
      snapshot({
        balance: { refillAmount: 5 },
        endpoints: { custom: [adminA] },
      }),
    );
    expect(plan.issues).toEqual([]);
    expect(plan.changed).toEqual([
      'mcpServers.github.url',
      'endpoints.custom.ollama',
      'endpoints.custom.AdminB',
      'endpoints.custom.AdminA',
      'balance',
      'endpoints.openAI.titleModel',
    ]);
  });

  it('blocks the whole batch on an invalid entry, naming the entry and field', () => {
    const baseline = ((yaml.endpoints as t.ConfigRecord).custom as t.ConfigRecord[])[0];
    const plan = planConfigChanges(
      [
        { op: 'set', path: 'balance.startBalance', value: 5 },
        {
          op: 'upsertEntry',
          path: 'endpoints.custom',
          key: 'GPT',
          identity: 'GPT',
          baseline,
          value: { ...baseline, provider: 'openai' },
        },
      ],
      snapshot(),
    );
    expect(plan.issues).toMatchObject([
      { code: 'invalid_literal', entryIdentity: 'GPT', entryPath: 'provider' },
    ]);
  });

  describe('on a server that keeps dotted keys', () => {
    const dotted: t.ConfigFeatures = { ...BUNDLED_CONFIG_FEATURES, dottedKeys: true };

    it('sends a record with dotted keys whole, at its own path', () => {
      const profiles = { 'us.anthropic.claude-sonnet-4-6': 'arn:aws:bedrock:x' };
      const ops: t.ConfigChange[] = [
        { op: 'set', path: 'endpoints.bedrock.inferenceProfiles', value: profiles },
      ];
      expect(planConfigChanges(ops, snapshot()).issues.map((issue) => issue.code)).toEqual([
        'UNSAFE_KEY',
      ]);
      const plan = planConfigChanges(ops, snapshot(), dotted);
      expect(plan.issues).toEqual([]);
      expect(plan.sets).toEqual([
        { fieldPath: 'endpoints.bedrock.inferenceProfiles', value: profiles },
      ]);
    });

    it('refuses $-prefixed and prototype keys as reserved', () => {
      const plan = planConfigChanges(
        [
          {
            op: 'set',
            path: 'mcpServers.github.headers',
            value: { $where: '1', 'X-Thread.Id': '2' },
          },
        ],
        snapshot(),
        dotted,
      );
      expect(plan.issues).toMatchObject([
        { code: 'RESERVED_KEY', path: 'mcpServers.github.headers', params: { key: '$where' } },
      ]);
    });
  });

  it('names the entry of an unsafe key inside a stored endpoint list, not its stored position', () => {
    const baseline = ((yaml.endpoints as t.ConfigRecord).custom as t.ConfigRecord[])[1];
    const stored = {
      endpoints: { custom: [{ name: 'Tmp1', apiKey: 'k', baseURL: 'https://tmp' }] },
    };
    const plan = planConfigChanges(
      [
        {
          op: 'upsertEntry',
          path: 'endpoints.custom',
          key: 'Zai 2',
          identity: 'Zai 2',
          baseline,
          value: { ...baseline, headers: { 'x.dotted.key': 'val' } },
        },
      ],
      snapshot(stored),
    );
    expect(plan.issues).toMatchObject([
      {
        code: 'UNSAFE_KEY',
        path: 'endpoints.custom.1.headers',
        entryIdentity: 'Zai 2',
        entryPath: 'headers',
      },
    ]);
  });

  describe('blank text pre-flight', () => {
    const codes = (plan: t.WritePlan) => plan.issues.map((i) => [i.code, i.path]);

    it('blocks whitespace-only values and keys (no blank writes)', () => {
      const plan = planConfigChanges(
        [
          { op: 'set', path: 'endpoints.openAI.titleModel', value: '   ' },
          { op: 'set', path: 'interface.customWelcome', value: '\n' },
          { op: 'set', path: 'endpoints.all.headers', value: { '  ': 'value-only' } },
        ],
        snapshot(),
      );
      expect(codes(plan)).toEqual([
        ['BLANK_VALUE', 'endpoints.openAI.titleModel'],
        ['BLANK_VALUE', 'interface.customWelcome'],
        ['BLANK_KEY', 'endpoints.all.headers'],
      ]);
      expect(plan.issues[2].params).toEqual({ key: '  ' });
    });

    it('blocks a blank key the write path names (an imported header leaf)', () => {
      const plan = planConfigChanges(
        [{ op: 'set', path: 'endpoints.all.headers.  ', value: 'value-only' }],
        snapshot(),
      );
      expect(codes(plan)).toEqual([['BLANK_KEY', 'endpoints.all.headers']]);
    });

    it('names the endpoint whose Base URL is only spaces', () => {
      const plan = planConfigChanges(
        [
          {
            op: 'upsertEntry',
            path: 'endpoints.custom',
            key: 'Zai 2',
            identity: 'Zai 2',
            value: { name: 'Zai 2', baseURL: '   ' },
          },
        ],
        snapshot(),
      );
      expect(plan.issues).toMatchObject([
        { code: 'BLANK_VALUE', entryIdentity: 'Zai 2', entryPath: 'baseURL' },
      ]);
    });

    it('keeps non-blank strings verbatim, surrounding whitespace included', () => {
      const plan = planConfigChanges(
        [{ op: 'set', path: 'interface.customWelcome', value: '  Hello {{user.name}}\n' }],
        snapshot(),
      );
      expect(plan.issues).toEqual([]);
      expect(plan.sets).toEqual([
        { fieldPath: 'interface.customWelcome', value: '  Hello {{user.name}}\n' },
      ]);
    });

    it('stores whitespace-only stop sequences in any stop list', () => {
      const plan = planConfigChanges(
        [
          {
            op: 'upsertEntry',
            path: 'endpoints.custom',
            key: 'Zai 2',
            identity: 'Zai 2',
            value: { name: 'Zai 2', addParams: { stop: ['\n', '\n\n', ' '] } },
          },
          {
            op: 'set',
            path: 'modelSpecs.list',
            value: [
              {
                name: 'spec',
                label: 'Spec',
                preset: { endpoint: 'openAI', model: 'gpt-4o', stop: ['\n\n', '\n'] },
              },
            ],
          },
        ],
        snapshot(),
      );
      expect(plan.issues).toEqual([]);
      const custom = plan.sets.find((set) => set.fieldPath === 'endpoints.custom');
      expect(custom?.value).toEqual([{ name: 'Zai 2', addParams: { stop: ['\n', '\n\n', ' '] } }]);
      const specs = plan.sets.find((set) => set.fieldPath === 'modelSpecs.list');
      expect(specs?.value).toMatchObject([{ preset: { stop: ['\n\n', '\n'] } }]);
    });

    it('does not block a save over a blank value stored earlier in an untouched entry', () => {
      const stored = {
        endpoints: { custom: [{ name: 'Old', apiKey: 'k', baseURL: 'https://old', iconURL: ' ' }] },
      };
      const plan = planConfigChanges(
        [
          {
            op: 'upsertEntry',
            path: 'endpoints.custom',
            key: 'GPT',
            identity: 'GPT',
            value: { name: 'GPT', modelDisplayLabel: 'GPT 4' },
          },
        ],
        snapshot(stored),
      );
      expect(plan.issues.filter((i) => i.code === 'BLANK_VALUE')).toEqual([]);
    });
  });

  it('blocks a YAML endpoint delete before anything is written', () => {
    const plan = planConfigChanges(
      [{ op: 'removeEntry', path: 'endpoints.custom', key: 'Zai 2', identity: 'Zai 2' }],
      snapshot(),
    );
    expect(plan.issues.map((i) => i.code)).toEqual(['YAML_ENTRY_IMMUTABLE']);
  });

  it('sends no reset for a value the target does not override (D3)', () => {
    const plan = planConfigChanges(
      [
        { op: 'reset', path: 'balance.refillAmount' },
        { op: 'reset', path: 'balance.nothingHere' },
      ],
      snapshot({ balance: { startBalance: 5 } }),
    );
    expect(plan.resets).toEqual([]);
    expect(plan.skipped).toEqual([{ fieldPath: 'balance.refillAmount', reason: 'yamlValue' }]);
    expect(plan.effective).toBe(0);
  });

  it('writes a setting of a stored boolean switch through the switch, as an object', () => {
    const plan = planConfigChanges(
      [{ op: 'set', path: 'interface.schedules.maxPerUser', value: 5 }],
      snapshot({ interface: { schedules: false } }),
    );
    expect(plan.issues).toEqual([]);
    expect(plan.sets).toEqual([{ fieldPath: 'interface.schedules', value: { maxPerUser: 5 } }]);
    expect(plan.storedAfter).toEqual({ interface: { schedules: { maxPerUser: 5 } } });
  });

  it('folds a switch turned on and its settings into one object write', () => {
    const plan = planConfigChanges(
      [
        { op: 'set', path: 'interface.schedules.fireConcurrency', value: 2 },
        { op: 'set', path: 'interface.schedules', value: true },
        { op: 'set', path: 'interface.schedules.maxPerUser', value: 5 },
      ],
      snapshot({ interface: { schedules: true } }),
    );
    expect(plan.sets).toEqual([
      { fieldPath: 'interface.schedules', value: { fireConcurrency: 2, maxPerUser: 5 } },
    ]);
  });

  it('writes into a stored object switch key by key', () => {
    const plan = planConfigChanges(
      [{ op: 'set', path: 'interface.schedules.maxPerUser', value: 5 }],
      snapshot({ interface: { schedules: { fireConcurrency: 2 } } }),
    );
    expect(plan.sets).toEqual([{ fieldPath: 'interface.schedules.maxPerUser', value: 5 }]);
  });

  it('removes an ignored override from a librechat.yaml-only section without validating it', () => {
    const plan = planConfigChanges(
      [{ op: 'reset', path: 'turnstile.siteKey' }],
      snapshot({ turnstile: { siteKey: 'abc' } }, { turnstile: { options: { theme: 'auto' } } }),
    );
    expect(plan.issues).toEqual([]);
    expect(plan.resets).toEqual(['turnstile']);
  });

  it('removes a stored secret the API returns only as its preview', () => {
    const plan = planConfigChanges(
      [{ op: 'reset', path: 'webSearch.tavilyApiKey' }],
      snapshot({ webSearch: { tavilyApiKeyPreview: 'tvly-S...c123' }, balance: { enabled: true } }),
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.resets).toEqual(['webSearch']);
    expect(plan.storedAfter).toEqual({ balance: { enabled: true } });
  });

  it('removes the emptied parent instead of leaving {} behind (SV-7)', () => {
    const plan = planConfigChanges(
      [{ op: 'reset', path: 'balance.startBalance' }],
      snapshot({ balance: { startBalance: 5 }, interface: { customWelcome: 'hi' } }),
    );
    expect(plan.resets).toEqual(['balance']);
    expect(plan.storedAfter).toEqual({ interface: { customWelcome: 'hi' } });
  });

  it('blocks a new custom endpoint LibreChat could not load, but not edits of librechat.yaml entries', () => {
    const added = planConfigChanges(
      [
        {
          op: 'upsertEntry',
          path: 'endpoints.custom',
          key: 'OnlyName',
          identity: null,
          value: { name: 'OnlyName' },
        },
      ],
      snapshot(),
    );
    expect(added.issues.map((issue) => [issue.entryPath, issue.code])).toEqual([
      ['apiKey', 'required'],
      ['baseURL', 'required'],
      ['models.default', 'models_required'],
    ]);
    const edited = planConfigChanges(
      [
        {
          op: 'upsertEntry',
          path: 'endpoints.custom',
          key: 'Zai 2',
          identity: 'Zai 2',
          value: { name: 'Zai 2', baseURL: 'https://zai2' },
          baseline: { name: 'Zai 2', baseURL: 'https://zai' },
        },
      ],
      snapshot(),
    );
    expect(edited.issues).toEqual([]);
  });

  it('counts a stored encrypted key (shown only as a preview) as the endpoint API key', () => {
    const stored = {
      endpoints: {
        custom: [
          {
            name: 'Vault',
            apiKeyPreview: 'sk-...',
            baseURL: 'https://v',
            models: { default: ['m'] },
          },
        ],
      },
    };
    const plan = planConfigChanges(
      [
        {
          op: 'upsertEntry',
          path: 'endpoints.custom',
          key: 'Vault',
          identity: 'Vault',
          value: { name: 'Vault', baseURL: 'https://v2', models: { default: ['m'] } },
          baseline: { name: 'Vault', baseURL: 'https://v', models: { default: ['m'] } },
        },
      ],
      snapshot(stored),
    );
    expect(plan.issues).toEqual([]);
  });

  it('widens a reset through every parent it leaves empty, up to the section', () => {
    const plan = planConfigChanges(
      [{ op: 'reset', path: 'endpoints.anthropic.models.default' }],
      snapshot({ endpoints: { anthropic: { models: { default: ['claude-opus-5-5'] } } } }),
    );
    expect(plan.resets).toEqual(['endpoints']);
    expect(plan.storedAfter).toEqual({});
  });

  it('never widens a reset past a parent with a stored tombstone under it', () => {
    const plan = planConfigChanges(
      [{ op: 'reset', path: 'balance.startBalance' }],
      snapshot({ balance: { startBalance: 5 } }, yaml, ['balance.refillAmount']),
    );
    expect(plan.resets).toEqual(['balance.startBalance']);
  });

  it('widens over a stored tombstone the same batch unhides', () => {
    const plan = planConfigChanges(
      [
        { op: 'reset', path: 'memory.agent.provider' },
        { op: 'reset', path: 'memory.agent.model' },
        { op: 'untombstone', path: 'memory.agent.id' },
      ],
      snapshot({ memory: { agent: { provider: 'openAI', model: 'gpt-4o-mini' } } }, yaml, [
        'memory.agent.id',
      ]),
    );
    expect(plan.resets).toEqual(['memory']);
    expect(plan.untombstones).toEqual(['memory.agent.id']);
    expect(plan.storedAfter).toEqual({});
  });

  it('never widens a reset past a tombstone the same batch writes', () => {
    const plan = planConfigChanges(
      [
        { op: 'reset', path: 'balance.startBalance' },
        { op: 'tombstone', path: 'balance.refillAmount' },
      ],
      snapshot({ balance: { startBalance: 5 } }),
    );
    expect(plan.resets).toEqual(['balance.startBalance']);
    expect(plan.tombstones).toEqual(['balance.refillAmount']);
  });

  it('still widens over tombstones under the reset path itself, which the reset removes anyway', () => {
    const plan = planConfigChanges(
      [{ op: 'reset', path: 'mcpServers.github.headers' }],
      snapshot({ mcpServers: { github: { headers: { 'X-A': '1' } } } }, yaml, [
        'mcpServers.github.headers.Authorization',
      ]),
    );
    expect(plan.resets).toEqual(['mcpServers']);
  });

  it('widens up to the last parent without another tombstone under it', () => {
    const plan = planConfigChanges(
      [{ op: 'reset', path: 'endpoints.anthropic.models.default' }],
      snapshot({ endpoints: { anthropic: { models: { default: ['claude-opus-5-5'] } } } }, yaml, [
        'endpoints.anthropic.titleModel',
      ]),
    );
    expect(plan.resets).toEqual(['endpoints.anthropic.models']);
  });

  it('sends a reset as is to a server that prunes emptied parents itself', () => {
    const plan = planConfigChanges(
      [{ op: 'reset', path: 'endpoints.anthropic.models.default' }],
      snapshot({ endpoints: { anthropic: { models: { default: ['claude-opus-5-5'] } } } }),
      { ...BUNDLED_CONFIG_FEATURES, prunesEmptyParents: true },
    );
    expect(plan.resets).toEqual(['endpoints.anthropic.models.default']);
    expect(plan.issues).toEqual([]);
  });

  it('folds a reset with new descendant values into one set (rename onto the same key)', () => {
    const stored = { mcpServers: { srv: { type: 'sse', url: 'https://old', title: 'Old' } } };
    const plan = planConfigChanges(
      [
        { op: 'reset', path: 'mcpServers.srv' },
        { op: 'set', path: 'mcpServers.srv.type', value: 'streamable-http' },
        { op: 'set', path: 'mcpServers.srv.url', value: 'https://new' },
      ],
      snapshot(stored),
    );
    expect(plan.resets).toEqual([]);
    expect(plan.sets).toEqual([
      { fieldPath: 'mcpServers.srv', value: { type: 'streamable-http', url: 'https://new' } },
    ]);
  });

  it('runs whole-section validation (an invalid MCP title blocks a rename)', () => {
    const stored = { mcpServers: { renamer: { type: 'sse', url: 'https://sse.example.com/sse' } } };
    const plan = planConfigChanges(
      [
        { op: 'set', path: 'mcpServers.final-server.type', value: 'sse' },
        { op: 'set', path: 'mcpServers.final-server.url', value: 'https://sse.example.com/sse' },
        { op: 'set', path: 'mcpServers.final-server.title', value: 'Bad_Title!' },
        { op: 'reset', path: 'mcpServers.renamer' },
      ],
      snapshot(stored),
    );
    expect(plan.issues.map((i) => i.path)).toContain('mcpServers.final-server.title');
  });

  it('rejects process-backed MCP fields with the field named', () => {
    const plan = planConfigChanges(
      [{ op: 'set', path: 'mcpServers.local.command', value: 'npx' }],
      snapshot(),
    );
    expect(plan.issues).toMatchObject([
      { code: 'PROCESS_MCP_FIELD', path: 'mcpServers.local.command' },
    ]);
  });

  it('warns about YAML record keys a whole-object write cannot remove', () => {
    const plan = planConfigChanges(
      [{ op: 'set', path: 'mcpServers.github.headers', value: { 'X-Other': 'abc' } }],
      snapshot(),
    );
    expect(plan.warnings).toEqual([
      { path: 'mcpServers.github.headers', warning: 'yamlOnly', keys: ['Authorization'] },
    ]);
  });

  it('expands an item write of a plain array into the whole array', () => {
    const lower = { endpoints: { agents: { allowedProviders: ['openAI', 'anthropic'] } } };
    const plan = planConfigChanges(
      [{ op: 'set', path: 'endpoints.agents.allowedProviders.1', value: 'google' }],
      snapshot({}, lower),
    );
    expect(plan.sets).toEqual([
      { fieldPath: 'endpoints.agents.allowedProviders', value: ['openAI', 'google'] },
    ]);
  });

  it('never sends a setting LibreChat reads only at startup', () => {
    const plan = planConfigChanges(
      [
        { op: 'set', path: 'endpoints.agents.toolApproval.hooks.0', value: { module: 'm' } },
        { op: 'set', path: 'mcpSettings.catalogRecovery.maxStateEntries', value: 10 },
      ],
      snapshot(),
    );
    expect(plan.sets).toEqual([]);
    expect(plan.skipped).toEqual([
      { fieldPath: 'endpoints.agents.toolApproval.hooks.0', reason: 'yamlOnly' },
      { fieldPath: 'mcpSettings.catalogRecovery.maxStateEntries', reason: 'yamlOnly' },
    ]);
  });

  it('reports skipped read-only paths without sending them', () => {
    const plan = planConfigChanges(
      [
        { op: 'set', path: 'filters.messages.pii.action', value: 'block' },
        { op: 'set', path: 'interface.prompts', value: false },
      ],
      snapshot(),
    );
    expect(plan.sets).toEqual([]);
    expect(plan.skipped).toEqual([
      { fieldPath: 'filters.messages.pii.action', reason: 'baseOnly' },
      { fieldPath: 'interface.prompts', reason: 'permission' },
    ]);
  });
});

describe('planConfigChanges — change batches', () => {
  const batch: t.ConfigFeatures = {
    ...BUNDLED_CONFIG_FEATURES,
    changesBatch: true,
    expectedRevision: true,
  };
  const memoryYaml: t.ConfigRecord = { ...yaml, memory: { agent: { id: 'agent_yaml' } } };

  it('validates a hide alone on the end state, as the batch is judged', () => {
    const ops: t.ConfigChange[] = [{ op: 'tombstone', path: 'memory.agent.id' }];
    const legacy = planConfigChanges(ops, snapshot({}, memoryYaml));
    const batched = planConfigChanges(ops, snapshot({}, memoryYaml), batch);
    expect(legacy.issues).toEqual([]);
    expect(batched.issues.length).toBeGreaterThan(0);
    expect(batched.issues.every((issue) => issue.path.startsWith('memory.agent'))).toBe(true);
  });

  it('accepts a union switch whose hide and sets leave a valid section', () => {
    const plan = planConfigChanges(
      [
        { op: 'set', path: 'memory.agent.provider', value: 'openAI' },
        { op: 'set', path: 'memory.agent.model', value: 'gpt-4o-mini' },
        { op: 'tombstone', path: 'memory.agent.id' },
      ],
      snapshot({}, memoryYaml),
      batch,
    );
    expect(plan.issues).toEqual([]);
  });
});

describe('toBatchOps', () => {
  const features: t.ConfigFeatures = {
    ...BUNDLED_CONFIG_FEATURES,
    changesBatch: true,
    expectedRevision: true,
    prunesEmptyParents: true,
  };

  it('orders unhides, hides, sets, then resets, one unset per removed path', () => {
    const plan = planConfigChanges(
      [
        { op: 'set', path: 'balance.startBalance', value: 5 },
        { op: 'reset', path: 'balance.refillAmount' },
        { op: 'reset', path: 'balance.enabled' },
        { op: 'untombstone', path: 'balance.refillAmount' },
        { op: 'tombstone', path: 'mcpServers.github' },
      ],
      snapshot({ balance: { refillAmount: 3, enabled: false } }, yaml, ['balance.refillAmount']),
      features,
    );
    expect(toBatchOps(plan)).toEqual([
      { op: 'unset', fieldPath: 'balance.refillAmount' },
      { op: 'tombstone', fieldPath: 'mcpServers.github' },
      { op: 'set', fieldPath: 'balance.startBalance', value: 5 },
      { op: 'unset', fieldPath: 'balance.enabled' },
    ]);
  });

  it('unhides an entry before the edits and hides inside it, which the unhide would remove', () => {
    const url = 'https://example.org/mcp';
    const plan = planConfigChanges(
      [
        { op: 'untombstone', path: 'mcpServers.github' },
        { op: 'set', path: 'mcpServers.github.url', value: url },
        { op: 'tombstone', path: 'mcpServers.github.headers' },
      ],
      snapshot({}, yaml, ['mcpServers.github']),
      features,
    );
    expect(plan.issues).toEqual([]);
    expect(toBatchOps(plan)).toEqual([
      { op: 'unset', fieldPath: 'mcpServers.github' },
      { op: 'tombstone', fieldPath: 'mcpServers.github.headers' },
      { op: 'set', fieldPath: 'mcpServers.github.url', value: url },
    ]);
  });

  it('leaves out an edit inside an entry the same batch hides, which would show it again', () => {
    const plan = planConfigChanges(
      [
        { op: 'set', path: 'mcpServers.github.url', value: 'https://example.org/mcp' },
        { op: 'set', path: 'balance.startBalance', value: 5 },
        { op: 'tombstone', path: 'mcpServers.github' },
      ],
      snapshot({ mcpServers: { github: { url: 'https://stored.example.org/mcp' } } }),
      features,
    );
    expect(plan).toMatchObject({ issues: [], skipped: [], effective: 2 });
    expect(plan.sets).toEqual([{ fieldPath: 'balance.startBalance', value: 5 }]);
    expect(toBatchOps(plan)).toEqual([
      { op: 'tombstone', fieldPath: 'mcpServers.github' },
      { op: 'set', fieldPath: 'balance.startBalance', value: 5 },
    ]);
  });
});

describe('toBatchOps — one change per path', () => {
  it('leaves out the unset of a path the batch hides anyway', () => {
    const ops = toBatchOps({
      sets: [],
      resets: ['mcpServers.github'],
      tombstones: ['mcpServers.github'],
      untombstones: [],
      skipped: [],
      issues: [],
      warnings: [],
      storedAfter: {},
      effective: 2,
      changed: ['mcpServers.github'],
    });
    expect(ops).toEqual([{ op: 'tombstone', fieldPath: 'mcpServers.github' }]);
  });
});

describe('verifyWrite', () => {
  it('flags values LibreChat did not store, did not apply, or merges back', () => {
    const plan = planConfigChanges(
      [
        { op: 'set', path: 'balance.startBalance', value: 5 },
        { op: 'set', path: 'endpoints.bedrock.inferenceProfiles', value: { plain: 'arn:y' } },
        { op: 'set', path: 'mcpServers.github.headers', value: { 'X-Other': 'abc' } },
      ],
      snapshot(),
    );
    const storedActual = {
      balance: { startBalance: 5 },
      endpoints: { bedrock: { inferenceProfiles: {} } },
      mcpServers: { github: { headers: { 'X-Other': 'abc' } } },
    };
    const effective = { balance: { startBalance: 1000000 } };
    expect(verifyWrite(plan, snapshot(), storedActual, effective)).toEqual([
      { fieldPath: 'balance.startBalance', reason: 'notApplied' },
      { fieldPath: 'endpoints.bedrock.inferenceProfiles', reason: 'notStored' },
      { fieldPath: 'mcpServers.github.headers.Authorization', reason: 'yamlMerged' },
    ]);
  });

  it('compares a record with dotted keys whole, without splitting its keys into paths', () => {
    const headers = { 'x-portkey.config': 'cfg', 'X-Plain': '1' };
    const entry = {
      name: 'Portkey',
      apiKey: 'user_provided',
      baseURL: 'https://api.portkey.ai/v1',
      models: { default: ['m'] },
      headers,
    };
    const plan = planConfigChanges(
      [
        {
          op: 'upsertEntry',
          path: 'endpoints.custom',
          key: 'Portkey',
          identity: null,
          value: entry,
        },
      ],
      snapshot(),
      { ...BUNDLED_CONFIG_FEATURES, dottedKeys: true },
    );
    const storedActual = { endpoints: { custom: [entry] } };
    const yamlEntries = (yaml.endpoints as t.ConfigRecord).custom as t.ConfigRecord[];
    const effective = { endpoints: { custom: [...yamlEntries, entry] } };
    expect(verifyWrite(plan, snapshot(), storedActual, effective)).toEqual([]);
  });

  it('accepts redacted secrets and an effective value that differs from YAML', () => {
    const plan = planConfigChanges(
      [{ op: 'set', path: 'webSearch.tavilyApiKey', value: 'tvly-secret' }],
      snapshot(),
    );
    const storedActual = { webSearch: { tavilyApiKeyPreview: 'tvly-s...cret' } };
    expect(verifyWrite(plan, snapshot(), storedActual, { webSearch: {} })).toEqual([]);
  });
});

describe('mergedBackChanges', () => {
  const warnings: t.ConfigWarning[] = [
    { path: 'mcpServers.github.headers', warning: 'yamlOnly', keys: ['Authorization'] },
  ];

  it('blames librechat.yaml in Base and Base in a profile', () => {
    expect(mergedBackChanges(warnings)).toEqual([
      expect.objectContaining({
        fieldPath: 'mcpServers.github.headers.Authorization',
        reason: 'yamlMerged',
      }),
    ]);
    expect(mergedBackChanges(warnings, { ...snapshot(), lowerKind: 'inherited' })).toEqual([
      expect.objectContaining({
        fieldPath: 'mcpServers.github.headers.Authorization',
        reason: 'inheritedMerged',
      }),
    ]);
  });

  it("names an entry's key by the entry's position in the merged list, as a dot path", () => {
    const entryWarning: t.ConfigWarning[] = [
      {
        path: 'endpoints.custom',
        warning: 'yamlOnly',
        entryIdentity: 'Zai 2',
        keys: ['customParams.paramDefinitions'],
      },
    ];
    expect(mergedBackChanges(entryWarning, snapshot())).toEqual([
      {
        fieldPath: 'endpoints.custom.1.customParams.paramDefinitions',
        reason: 'yamlMerged',
        entryIdentity: 'Zai 2',
        entryPath: 'customParams.paramDefinitions',
      },
    ]);
  });
});
