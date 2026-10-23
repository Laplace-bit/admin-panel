import { render } from '@testing-library/react';
import { useEffect, useMemo, useState } from 'react';
import { configSchema } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  flattenObject,
  getValueAtPath,
  mergeScopeLayer,
  collectLeafPaths,
  createBaseLayers,
  planConfigChanges,
  filterInterfacePermissionChildren,
} from '@/utils';
import { useConfigEdits, useTabSections, runtimeDefaultAt, usePendingConfigValues } from '@/hooks';
import { extractSchemaTree, extractSchemaDefaults } from '@/server/config';
import { CollectionEditsContext } from '@/contexts/CollectionEditsContext';
import { buildConfigChanges } from '@/components/configuration/edits';
import { collectFieldPaths } from '@/components/configuration/counts';
import { ConfigTabContent } from '@/components/configuration';
import { ExpandContext } from '@/contexts/ExpandContext';

/** The schema tree exactly as `extractSchemaTree` returns it (interface permissions included). */
export const RAW_TREE: t.SchemaField[] = extractSchemaTree(configSchema as t.ZodSchemaLike);

/** The schema tree the page receives: the server drops the interface permission fields (Access page). */
export const PAGE_TREE: t.SchemaField[] = RAW_TREE.map((section) =>
  section.key === 'interface' && section.children
    ? { ...section, children: filterInterfacePermissionChildren(section.children) }
    : section,
);

/** jsdom has no ResizeObserver; Radix controls measure themselves with one. */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver;

const SCHEMA_DEFAULTS = flattenObject(
  extractSchemaDefaults(configSchema as t.ZodSchemaLike) as t.ConfigRecord,
);
const EXPANDED: t.ExpandSignal = { mode: 'expand', seq: 1 };
const IDLE: t.ExpandSignal = { mode: null, seq: 0 };

export interface TabHarnessOptions {
  /** The configuration tab to render (`providers`, `custom`, `specs`, `mcp`, …). */
  tab: string;
  /** The schema tree the page gets from the server; defaults to the real one. */
  tree?: t.SchemaField[];
  /** librechat.yaml as LibreChat loaded it. */
  yaml?: t.ConfigRecord;
  /** The base admin overrides. */
  overrides?: t.ConfigRecord;
  /** Press "Expand all" once rendered: every collapsible opens, lazily mounted ones too. */
  expandAll?: boolean;
}

export interface TabHarness {
  /** The page's pending edits, as `useConfigEdits` holds them now. */
  edits: () => t.ConfigEditsState;
  /** What Save would write now: the pending edits through the real change and write planners. */
  plan: () => t.WritePlan;
}

interface HarnessProps extends Required<Omit<TabHarnessOptions, 'expandAll'>> {
  expandAll: boolean;
  state: { edits: t.ConfigEditsState | null; plan: (() => t.WritePlan) | null };
}

function TabPage({ tab, tree, yaml, overrides, expandAll, state }: HarnessProps) {
  const schemaPathSet = useMemo(() => new Set(collectFieldPaths(tree)), [tree]);
  const config = useMemo(() => mergeScopeLayer(yaml, overrides), [yaml, overrides]);
  const layers = useMemo(
    () =>
      createBaseLayers(
        {
          config,
          yamlConfig: yaml,
          yamlPaths: collectLeafPaths(yaml),
          dbOverrides: overrides,
          dbTombstones: [],
          schemaDefaults: SCHEMA_DEFAULTS,
        },
        schemaPathSet,
        runtimeDefaultAt,
      ),
    [config, yaml, overrides, schemaPathSet],
  );
  const flatBaseline = useMemo(() => flattenObject(config), [config]);
  const edits = useConfigEdits({
    isEditingScope: false,
    flatBaseline,
    scopeResolvedValues: null,
    baseActiveConfigValues: config,
    schemaTree: tree,
    schemaPathSet,
  });
  const shown = usePendingConfigValues(config, edits.editedValues, layers);
  const sectionPermissions = useMemo(
    () =>
      Object.fromEntries(tree.map((section) => [section.key, { canView: true, canEdit: true }])),
    [tree],
  );
  const sections = useTabSections({
    schemaTree: tree,
    activeTab: tab,
    activeConfigValues: shown,
    sectionPermissions,
    editedValues: edits.editedValues,
  });
  const overridePaths = useMemo(() => new Set(layers.baseOverridePaths.paths), [layers]);
  const configuredPaths = useMemo(
    () => new Set([...layers.yamlPaths.paths, ...overridePaths]),
    [layers, overridePaths],
  );

  /** "Expand all" pressed once the tab has loaded, as the toolbar sends it. */
  const [signal, setSignal] = useState(IDLE);
  useEffect(() => {
    if (expandAll) setSignal(EXPANDED);
  }, [expandAll]);

  state.edits = edits;
  state.plan = () => {
    const changes = buildConfigChanges(edits.touchedPaths, edits.editedValues, schemaPathSet, {
      fields: tree,
      baselineAt: (path) => getValueAtPath(config, path),
      hasOverride: (path) => getValueAtPath(overrides, path) !== undefined,
      root: config,
      collections: edits.collectionEdits,
      visibility: edits.visibilityEdits,
    });
    return planConfigChanges(changes.ops, { stored: overrides, lower: yaml, lowerKind: 'yaml' });
  };

  return (
    <ExpandContext.Provider value={signal}>
      <CollectionEditsContext.Provider value={edits.collectionEdits}>
        <ConfigTabContent
          sections={sections}
          configValues={shown}
          editedValues={edits.editedValues}
          onFieldChange={edits.handleFieldChange}
          onResetField={edits.handleResetField}
          onDiscardField={edits.handleDiscardField}
          previewMode={false}
          permissions={{ canView: true, canEdit: true, canAssign: true }}
          showChangedOnly={false}
          configuredPaths={configuredPaths}
          dbOverridePaths={overridePaths}
          touchedPaths={edits.touchedPaths}
          pendingResets={edits.pendingResets}
          sectionPermissions={sectionPermissions}
          schemaDefaults={SCHEMA_DEFAULTS}
          editSessionId={edits.editSessionId}
          valueLayers={layers}
          visibilityEdits={edits.visibilityEdits}
          onHideField={edits.handleHideField}
          onUnhideField={edits.handleUnhideField}
        />
      </CollectionEditsContext.Provider>
    </ExpandContext.Provider>
  );
}

/**
 * Renders one configuration tab the way the page does in Base: the tab's
 * sections from `useTabSections` over the given schema tree, the real value
 * layers and `useConfigEdits`, and `ConfigTabContent`. `plan()` is what Save
 * would write for the edits made so far.
 */
export function renderTab({
  tab,
  tree = PAGE_TREE,
  yaml = {},
  overrides = {},
  expandAll = false,
}: TabHarnessOptions): TabHarness & ReturnType<typeof render> {
  const state: HarnessProps['state'] = { edits: null, plan: null };
  const result = render(
    <TabPage
      tab={tab}
      tree={tree}
      yaml={yaml}
      overrides={overrides}
      expandAll={expandAll}
      state={state}
    />,
  );
  return {
    ...result,
    edits: () => {
      if (!state.edits) throw new Error('the tab has not rendered');
      return state.edits;
    },
    plan: () => {
      if (!state.plan) throw new Error('the tab has not rendered');
      return state.plan();
    },
  };
}
