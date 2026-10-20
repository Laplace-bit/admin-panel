import { useState } from 'react';
import { render } from '@testing-library/react';
import { configSchema } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  flattenObject,
  getValueAtPath,
  setValueAtPath,
  createBaseLayers,
  collectLeafPaths,
  mergeScopeLayer,
} from '@/utils';
import { extractSchemaTree, extractSchemaDefaults, getSchemaPathSet } from '@/server/config';
import { SECTION_META } from '@/components/configuration/configMeta';
import { ConfigTabContent } from '@/components/configuration';
import { runtimeDefaultAt } from '@/hooks/config/layers';
import { READ_ONLY_CONFIG_SECTIONS } from '@/constants';

const TREE = extractSchemaTree(configSchema as t.ZodSchemaLike);
const SCHEMA_DEFAULTS = flattenObject(
  extractSchemaDefaults(configSchema as t.ZodSchemaLike) as t.ConfigRecord,
);
const SCHEMA_PATHS = getSchemaPathSet();

/** A tab's sections built from the real schema, as `useTabSections` does. */
export function tabSections(keys: string[]): t.ConfigSectionConfig[] {
  return keys.flatMap((key) => {
    const field = TREE.find((section) => section.key === key);
    if (!field) return [];
    const children = field.children ?? [];
    const structured = (field.isObject || field.type === 'record') && children.length > 0;
    const readOnlyReason = READ_ONLY_CONFIG_SECTIONS.get(key);
    return [
      {
        id: key,
        titleKey: SECTION_META[key]?.titleKey ?? key,
        descriptionKey: SECTION_META[key]?.descriptionKey,
        fields: structured ? children : [],
        ...(!structured && { sectionField: field }),
        ...(readOnlyReason && { readOnlyReason }),
      },
    ];
  });
}

export interface SectionsHarnessOptions {
  sections: string[];
  /** librechat.yaml as LibreChat loaded it. */
  yaml?: t.ConfigRecord;
  /** The base admin overrides. */
  overrides?: t.ConfigRecord;
  /** Called with every staged change, after the harness applies it. */
  onChange?: (path: string, value: t.ConfigValue) => void;
  onReset?: (path: string) => void;
  readOnly?: boolean;
}

/** Base-mode value layers from a librechat.yaml and base overrides, built by the page's own code. */
export function baseLayers(yaml: t.ConfigRecord, overrides: t.ConfigRecord): t.ValueLayers {
  return createBaseLayers(
    {
      config: mergeScopeLayer(yaml, overrides),
      yamlConfig: yaml,
      yamlPaths: collectLeafPaths(yaml),
      dbOverrides: overrides,
      dbTombstones: [],
      schemaDefaults: SCHEMA_DEFAULTS,
    },
    SCHEMA_PATHS,
    runtimeDefaultAt,
  );
}

function Harness({
  sections,
  yaml = {},
  overrides = {},
  onChange,
  onReset,
  readOnly,
}: SectionsHarnessOptions) {
  const layers = baseLayers(yaml, overrides);
  const [edited, setEdited] = useState<t.FlatConfigMap>({});
  const [values, setValues] = useState<t.ConfigRecord>(layers.effective ?? {});
  const configured = new Set([...collectLeafPaths(yaml), ...collectLeafPaths(overrides)]);
  const stage = (path: string, value: t.ConfigValue) => {
    setEdited((prev) => ({ ...prev, [path]: value }));
    setValues((prev) =>
      setValueAtPath(prev, path, value === undefined ? getValueAtPath(yaml, path) : value),
    );
    onChange?.(path, value);
  };
  const discard = (path: string) => {
    setEdited((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setValues((prev) => setValueAtPath(prev, path, getValueAtPath(layers.effective ?? {}, path)));
  };
  const permissions = Object.fromEntries(
    sections.map((key) => [key, { canView: true, canEdit: true }]),
  );
  return (
    <ConfigTabContent
      sections={tabSections(sections)}
      configValues={values}
      editedValues={edited}
      onFieldChange={stage}
      onResetField={(path) => {
        onReset?.(path);
        stage(path, undefined);
      }}
      onDiscardField={discard}
      readOnly={readOnly}
      permissions={{ canView: true, canEdit: !readOnly }}
      sectionPermissions={permissions}
      configuredPaths={configured}
      dbOverridePaths={new Set(collectLeafPaths(overrides))}
      touchedPaths={new Set(Object.keys(edited))}
      pendingResets={new Set()}
      schemaDefaults={SCHEMA_DEFAULTS}
      valueLayers={layers}
    />
  );
}

/** Renders a tab's sections through the real `ConfigTabContent`, with staged edits applied. */
export function renderSections(options: SectionsHarnessOptions) {
  return render(<Harness {...options} />);
}
