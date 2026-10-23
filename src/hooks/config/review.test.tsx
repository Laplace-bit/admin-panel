import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configSchema } from 'librechat-data-provider';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { extractSchemaTree, getSchemaPathSet } from '@/server/config';
import { useChangeReview } from './review';
import { useConfigEdits } from './edits';
import { flattenObject } from '@/utils';
import { applyConfigChangesFn } from '@/server';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { createServerContract } from '@/test/fixtures';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { useConfigSave } from './save';
import '@/locales/i18n';

vi.mock('@/server', () => ({ applyConfigChangesFn: vi.fn(), resetBaseConfigFn: vi.fn() }));

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const schemaPathSet = getSchemaPathSet();
const models = { default: ['kimi-k2.5'] };
const moonshot = {
  name: 'Moonshot',
  apiKey: '${KIMI}',
  baseURL: 'https://api.moonshot.ai/v1',
  models,
};
const zai = { name: 'Zai 2', apiKey: 'user_provided', baseURL: 'https://zai', models };
const yaml: t.ConfigRecord = {
  balance: { startBalance: 1000000 },
  endpoints: { custom: [moonshot, zai] },
};

/** The page's edit, save and review hooks over a base config: librechat.yaml, and what the panel stored. */
function renderPage(
  config: t.ConfigRecord = yaml,
  dbOverrides: t.ConfigRecord = {},
  yamlConfig: t.ConfigRecord = config,
  contract: t.ConfigContract = BUNDLED_CONFIG_CONTRACT,
  initialRevision?: string | null,
) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ConfigContractContext.Provider value={contract}>{children}</ConfigContractContext.Provider>
    </QueryClientProvider>
  );
  return renderHook(
    ({ targetRevision }: { targetRevision?: string | null }) => {
      const edits = useConfigEdits({
        isEditingScope: false,
        flatBaseline: flattenObject(config),
        scopeResolvedValues: null,
        baseActiveConfigValues: config,
        schemaTree: tree,
        schemaPathSet,
      });
      const layers = {
        configValues: config,
        dbOverrides,
        yamlConfig,
        yamlMcpServers: {},
        schemaDefaults: {},
        schemaPathSet,
        overridePaths: new Set(Object.keys(flattenObject(dbOverrides))),
        valueLayers: null,
        baseActiveConfigValues: config,
        targetRevision,
      };
      const save = useConfigSave({ schemaTree: tree, schemaPathSet, layers, edits });
      const review = useChangeReview({
        schemaTree: tree,
        layers,
        edits,
        save,
        onTabChange: () => undefined,
      });
      return { edits, save, review };
    },
    { wrapper, initialProps: { targetRevision: initialRevision } },
  );
}

describe('the change review over the save pipeline (WS1 × WS7)', () => {
  it('shows one entry field change, although the write is a per-entry op', () => {
    const { result } = renderPage();
    act(() =>
      result.current.edits.handleFieldChange('endpoints.custom.0', {
        ...moonshot,
        baseURL: 'https://api.moonshot.cn/v1',
      }),
    );
    const { review } = result.current;
    expect(review.model.count).toBe(1);
    expect(review.blocked).toBe(false);
    const rows = review.model.tabs.flatMap((tab) =>
      tab.sections.flatMap((section) => [
        ...section.rows,
        ...section.entries.flatMap((entry) => entry.rows),
      ]),
    );
    expect(rows.map((row) => row.item.path)).toEqual(['endpoints.custom.0.baseURL']);
    expect(rows[0].item).toMatchObject({
      before: 'https://api.moonshot.ai/v1',
      after: 'https://api.moonshot.cn/v1',
    });
  });

  it('warns that a value Global overrides take precedence over has no effect (D11)', () => {
    const { result } = renderPage({
      ...yaml,
      endpoints: { ...(yaml.endpoints as t.ConfigRecord), all: { activityModel: 'gpt-luna' } },
    });
    act(() => result.current.edits.handleFieldChange('endpoints.openAI.activityModel', 'gpt-x'));
    const rows = result.current.review.model.tabs.flatMap((tab) =>
      tab.sections.flatMap((section) => section.rows),
    );
    expect(rows.map((row) => [row.item.path, row.item.warnings])).toEqual([
      ['endpoints.openAI.activityModel', ['shadowed']],
    ]);
  });

  it('says a provider title setting is ignored while Global exists, even where Global leaves it unset (D11)', () => {
    const { result } = renderPage({
      ...yaml,
      endpoints: { ...(yaml.endpoints as t.ConfigRecord), all: { activityModel: 'gpt-luna' } },
    });
    act(() => result.current.edits.handleFieldChange('endpoints.openAI.titleModel', 'gpt-x'));
    const rows = result.current.review.model.tabs.flatMap((tab) =>
      tab.sections.flatMap((section) => section.rows),
    );
    expect(rows.map((row) => [row.item.path, row.item.warnings])).toEqual([
      ['endpoints.openAI.titleModel', ['shadowedBlock']],
    ]);
  });

  it('warns per field on a server that resolves titles per field, the endpoint and model together', () => {
    const config = {
      ...yaml,
      endpoints: { ...(yaml.endpoints as t.ConfigRecord), all: { titleEndpoint: 'anthropic' } },
    };
    const { result } = renderPage(
      config,
      {},
      config,
      createServerContract({}, { titleResolution: 'field' }),
    );
    act(() => {
      result.current.edits.handleFieldChange('endpoints.openAI.titleModel', 'gpt-x');
      result.current.edits.handleFieldChange('endpoints.openAI.titleMethod', 'completion');
    });
    const rows = result.current.review.model.tabs.flatMap((tab) =>
      tab.sections.flatMap((section) => section.rows),
    );
    expect(rows.map((row) => [row.item.path, row.item.warnings])).toEqual([
      ['endpoints.openAI.titleModel', ['shadowedPair']],
      ['endpoints.openAI.titleMethod', undefined],
    ]);
  });

  it("blocks Save on the pipeline's issue when a librechat.yaml entry is removed (D1)", () => {
    const { result } = renderPage();
    act(() => result.current.edits.handleFieldChange('endpoints.custom', [moonshot]));
    const { review } = result.current;
    expect(review.blocked).toBe(true);
    expect(review.model.issues.map((issue) => issue.message).join(' ')).toMatch(/Zai 2/);
  });

  it('undoes a server rename but keeps its field edit, under the old name again', () => {
    const dbsrv = { type: 'streamable-http', url: 'https://db.example/mcp', title: 'DB' };
    const stored = { mcpServers: { dbsrv } };
    const { result } = renderPage(stored, stored, {});
    act(() => {
      const { edits } = result.current;
      edits.handleFieldChange('mcpServers.dbsrv', undefined);
      for (const [key, value] of Object.entries(dbsrv)) {
        edits.handleFieldChange(`mcpServers.dbsrv2.${key}`, value);
      }
      edits.handleRenameEntry('mcpServers.dbsrv', 'mcpServers.dbsrv2');
    });
    act(() => result.current.edits.handleFieldChange('mcpServers.dbsrv2.title', 'Docs'));
    const rows = result.current.review.model.tabs.flatMap((tab) =>
      tab.sections.flatMap((section) => [
        ...section.rows,
        ...section.entries.flatMap((entry) => entry.rows),
      ]),
    );
    expect(rows.map((row) => [row.item.kind, row.item.path])).toEqual([
      ['renamed', 'mcpServers.dbsrv2'],
      ['changed', 'mcpServers.dbsrv2.title'],
    ]);
    act(() => result.current.review.revertRow(rows[0]));
    expect(result.current.edits.editedValues).toEqual({ 'mcpServers.dbsrv.title': 'Docs' });
    expect(result.current.edits.renameEdits).toEqual({});
  });
});

describe('saving against the loaded revision (changesBatch)', () => {
  const batch = createServerContract({ changesBatch: true, expectedRevision: true });
  const applyMock = vi.mocked(applyConfigChangesFn);
  const saved: t.ApplyConfigChangesResult = {
    applied: 1,
    failed: [],
    warnings: [],
    issues: [],
    skipped: [],
    reported: [],
  };
  const conflicted: t.ApplyConfigChangesResult = {
    ...saved,
    applied: 0,
    conflict: true,
    failed: [{ path: '', code: 'CONFIG_VERSION_CONFLICT', message: 'changed' }],
  };
  const sentRevisions = () =>
    applyMock.mock.calls.map(
      ([call]) => (call as { data: { expectedRevision?: string } }).data.expectedRevision,
    );

  beforeEach(() => {
    applyMock.mockReset();
  });

  async function editAndSave(result: {
    current: ReturnType<typeof renderPage>['result']['current'];
  }) {
    act(() => result.current.edits.handleFieldChange('balance.startBalance', 5));
    act(() => result.current.save.openReview());
    await act(() => result.current.review.confirm());
  }

  it('sends the revision the page loaded the target at', async () => {
    applyMock.mockResolvedValue(saved);
    const { result } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    expect(sentRevisions()).toEqual(['base:4']);
    expect(result.current.edits.editedValues).toEqual({});
  });

  it('names a target without a document as absent', async () => {
    applyMock.mockResolvedValue(saved);
    const { result } = renderPage(yaml, {}, yaml, batch, null);
    await editAndSave(result);
    expect(sentRevisions()).toEqual(['absent']);
  });

  it('sends no revision to a server without change batches', async () => {
    applyMock.mockResolvedValue(saved);
    const { result } = renderPage(yaml, {}, yaml, BUNDLED_CONFIG_CONTRACT, 'base:4');
    await editAndSave(result);
    expect(sentRevisions()).toEqual([undefined]);
  });

  it('keeps the edits after a conflict, and merges them over the latest version', async () => {
    applyMock.mockResolvedValueOnce(conflicted).mockResolvedValueOnce(saved);
    const { result } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    expect(result.current.review.conflict).toBe(true);
    expect(result.current.review.open).toBe(true);
    expect(result.current.review.saveIssues).toEqual([]);
    expect(result.current.edits.editedValues).toEqual({ 'balance.startBalance': 5 });
    await act(() => result.current.review.mergeLatest());
    expect(sentRevisions()).toEqual(['base:4', undefined]);
    expect(result.current.review.conflict).toBe(false);
    expect(result.current.edits.editedValues).toEqual({});
  });

  it("does not save from the footer over the other admin's version after a conflict", async () => {
    applyMock.mockResolvedValueOnce(conflicted).mockResolvedValue(saved);
    const { result, rerender } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    rerender({ targetRevision: 'base:5' });
    await act(() => result.current.review.confirm());
    expect(sentRevisions()).toEqual(['base:4']);
    expect(result.current.review.conflict).toBe(true);
    expect(result.current.review.open).toBe(true);
    expect(result.current.edits.editedValues).toEqual({ 'balance.startBalance': 5 });
    await act(() => result.current.review.mergeLatest());
    expect(sentRevisions()).toEqual(['base:4', undefined]);
    expect(result.current.edits.editedValues).toEqual({});
  });

  it('saves against the version the review re-read once it is closed and opened again', async () => {
    applyMock.mockResolvedValueOnce(conflicted).mockResolvedValue(saved);
    const { result, rerender } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    rerender({ targetRevision: 'base:5' });
    act(() => result.current.review.closeReview());
    expect(result.current.review.conflict).toBe(false);
    expect(result.current.edits.editedValues).toEqual({ 'balance.startBalance': 5 });
    act(() => result.current.review.openReview());
    await act(() => result.current.review.confirm());
    expect(sentRevisions()).toEqual(['base:4', 'base:5']);
    expect(result.current.edits.editedValues).toEqual({});
  });

  it('says earlier batches stay saved when a later batch of a split save meets a conflict', async () => {
    applyMock.mockResolvedValueOnce({
      ...saved,
      applied: 0,
      partiallyWritten: true,
      failed: [{ path: 'balance.startBalance', code: 'CONFIG_VERSION_CONFLICT', message: 'x' }],
    });
    const { result } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    expect(result.current.review.conflict).toBe(false);
    expect(result.current.edits.saveError).toMatch(/^Save failed partway: the changes written/);
    expect(result.current.edits.editedValues).toEqual({ 'balance.startBalance': 5 });
  });

  it('drops the edits and closes the review on Reload after a conflict', async () => {
    applyMock.mockResolvedValueOnce(conflicted);
    const { result } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    act(() => result.current.review.reloadLatest());
    expect(result.current.review.conflict).toBe(false);
    expect(result.current.review.open).toBe(false);
    expect(result.current.edits.editedValues).toEqual({});
    expect(applyMock).toHaveBeenCalledTimes(1);
  });
});
