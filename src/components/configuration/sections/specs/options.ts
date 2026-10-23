import { useContext, useMemo } from 'react';
import type * as t from '@/types';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { isConfigRecord, getValueAtPath } from '@/utils';
import { useLocalize, useOptionSources } from '@/hooks';
import { BUILT_IN_ENDPOINTS, specEndpoint } from './validation';
import { labelForPath } from '../../meta';

function stringsOf(value: t.ConfigValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

/** Options with duplicate values dropped (the first label wins). */
export function uniqueOptions(options: t.SelectOption[]): t.SelectOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

function customEndpointsOf(root: t.ConfigValue): Map<string, t.ConfigRecord> {
  const custom = getValueAtPath(root, 'endpoints.custom');
  const byName = new Map<string, t.ConfigRecord>();
  for (const entry of Array.isArray(custom) ? custom : []) {
    if (isConfigRecord(entry) && typeof entry.name === 'string' && entry.name.trim() !== '') {
      byName.set(entry.name, entry);
    }
  }
  return byName;
}

/**
 * Endpoint choices for a spec: the built-in providers, then the custom
 * endpoints the configuration defines, then any WS9 option source adds.
 */
export function endpointOptions(
  customNames: Iterable<string>,
  localize: t.LocalizeFn,
  extra: t.SelectOption[] = [],
): t.SelectOption[] {
  return uniqueOptions([
    ...BUILT_IN_ENDPOINTS.map((name) => ({
      value: name,
      label: labelForPath(`endpoints.${name}`, localize),
    })),
    ...[...customNames].map((name) => ({ value: name, label: name })),
    ...extra,
  ]);
}

/** Models to suggest for an endpoint: a custom endpoint's model list, then models other specs use with it. */
export function modelSuggestions(
  endpoint: string,
  custom: t.ConfigRecord | undefined,
  items: t.ConfigValue[],
): t.SelectOption[] {
  const listed = isConfigRecord(custom?.models) ? stringsOf(custom.models.default) : [];
  const used = items.flatMap((spec) => {
    if (!isConfigRecord(spec) || specEndpoint(spec) !== endpoint) return [];
    const preset = isConfigRecord(spec.preset) ? spec.preset : {};
    return typeof preset.model === 'string' && preset.model.trim() !== '' ? [preset.model] : [];
  });
  return uniqueOptions([...listed, ...used].map((model) => ({ value: model, label: model })));
}

/** Group names the specs use, then endpoint names (a group named after an endpoint nests under it). */
export function groupOptions(
  items: t.ConfigValue[],
  endpoints: t.SelectOption[],
): t.SelectOption[] {
  const groups = items.flatMap((spec) =>
    isConfigRecord(spec) && typeof spec.group === 'string' && spec.group.trim() !== ''
      ? [{ value: spec.group, label: spec.group }]
      : [],
  );
  return uniqueOptions([...groups, ...endpoints]);
}

/**
 * Everything the spec editor offers to pick from, read from the configuration
 * shown on the page (pending edits included) and merged with WS9's
 * `useOptionSources` where it provides more.
 */
export function useSpecOptions(items: t.ConfigValue[]): t.SpecOptions {
  const localize = useLocalize();
  const root = useContext(ConfigValuesContext)?.configValues ?? null;
  const endpointSource = useOptionSources('endpoints');
  const mcpSource = useOptionSources('mcpServers');
  const customEndpoints = useMemo(() => customEndpointsOf(root), [root]);
  const mcpRecord = getValueAtPath(root, 'mcpServers');

  const endpoints = useMemo(
    () => endpointOptions(customEndpoints.keys(), localize, endpointSource.options),
    [customEndpoints, localize, endpointSource.options],
  );
  const mcpServers = useMemo(
    () =>
      uniqueOptions([
        ...Object.keys(isConfigRecord(mcpRecord) ? mcpRecord : {}).map((name) => ({
          value: name,
          label: name,
        })),
        ...mcpSource.options,
      ]),
    [mcpRecord, mcpSource.options],
  );

  return useMemo(
    () => ({
      endpoints,
      knownEndpoints: new Set(endpoints.map((option) => option.value)),
      customEndpoints: new Set(customEndpoints.keys()),
      mcpServers,
      groups: groupOptions(items, endpoints),
      modelsFor: (endpoint: string) =>
        modelSuggestions(endpoint, customEndpoints.get(endpoint), items),
      customEndpoint: (name: string) => customEndpoints.get(name),
    }),
    [endpoints, customEndpoints, mcpServers, items],
  );
}
