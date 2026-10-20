import { useContext, useMemo } from 'react';
import type * as t from '@/types';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { getValueAtPath, isConfigRecord } from '@/utils';
import { useFieldState } from './field';

/** librechat.yaml as LibreChat loaded it (no admin overrides), or null outside the page. */
export function useYamlConfig(): t.ConfigRecord | null {
  return useContext(ConfigValuesContext)?.layers?.yamlEffective ?? null;
}

/** Field states of `fileStrategy` and every `fileStrategies` key (FX-6). */
export function useStorageStates(): t.StorageFieldStates {
  return {
    primary: useFieldState('fileStrategy'),
    default: useFieldState('fileStrategies.default'),
    avatar: useFieldState('fileStrategies.avatar'),
    image: useFieldState('fileStrategies.image'),
    document: useFieldState('fileStrategies.document'),
    skills: useFieldState('fileStrategies.skills'),
  };
}

/** Names of the custom endpoints the page shows (pending edits included), for `fileConfig.endpoints` keys. */
export function useCustomEndpointNames(): string[] {
  const values = useContext(ConfigValuesContext);
  const root = values?.configValues ?? values?.layers?.effective ?? null;
  const list = getValueAtPath(root, 'endpoints.custom');
  return useMemo(() => {
    if (!Array.isArray(list)) return [];
    const names = new Set<string>();
    for (const entry of list) {
      const name = isConfigRecord(entry) ? entry.name : undefined;
      if (typeof name === 'string' && name.trim() !== '') names.add(name);
    }
    return [...names];
  }, [list]);
}
