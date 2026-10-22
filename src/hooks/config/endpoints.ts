import { useContext, useMemo } from 'react';
import type * as t from '@/types';
import {
  getEntryKey,
  isConfigRecord,
  getValueAtPath,
  hasHiddenSecret,
  isConfigValueEqual,
  getKeyedCollection,
  overriddenEntryKeys,
} from '@/utils';
import {
  endpointHost,
  fetchesModels,
  modelNames,
  validateEndpoint,
} from '@/components/configuration/sections/endpoints/model';
import { CollectionEditsContext } from '@/contexts/CollectionEditsContext';
import { getEntryTitle } from '@/components/configuration/fields/entries';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { useLocalize } from '../useLocalize';
import { useListKeys } from './keys';

const NAME_KEY = 'name';

function nameOf(item: t.ConfigValue): string | null {
  return getEntryKey(item, NAME_KEY) ?? null;
}

function byName(list: t.ConfigValue): Map<string, t.ConfigRecord> {
  const map = new Map<string, t.ConfigRecord>();
  if (!Array.isArray(list)) return map;
  for (const entry of list) {
    const name = getEntryKey(entry, NAME_KEY);
    if (name !== undefined && isConfigRecord(entry)) map.set(name, entry);
  }
  return map;
}

/**
 * The custom endpoint list of the open target as the endpoint editor shows
 * it (WS10): per row where the endpoint comes from (librechat.yaml, the admin
 * panel, Base or the profile), whether the target overrides it, whether it is
 * new or edited, and what keeps it from being saved or served; plus the
 * saved endpoints a pending edit removes. Renames and removals are read from
 * the page's pending collection edits, so they survive Discard → Undo.
 */
export function useEndpointRows({ path, items }: t.EndpointRowsOptions): t.EndpointRows {
  const localize = useLocalize();
  const layers = useContext(ConfigValuesContext)?.layers ?? null;
  const edit = useContext(CollectionEditsContext)[path];
  const keys = useListKeys({ items, identity: nameOf, prefix: 'endpoint' });

  const context = useMemo(() => {
    const collection = getKeyedCollection(path);
    const lowerRoot = layers?.scope ? layers.base : (layers?.yamlEffective ?? null);
    const storedRoot = layers?.scope ? layers.scope.overrides : (layers?.baseOverrides ?? null);
    const lowerList = getValueAtPath(lowerRoot, path);
    const storedList = getValueAtPath(storedRoot, path);
    return {
      collection,
      lower: byName(lowerList),
      stored: byName(storedList),
      saved: byName(getValueAtPath(layers?.effective ?? null, path)),
      overridden: collection
        ? overriddenEntryKeys(collection, storedList, lowerList)
        : new Set<string>(),
      isScope: layers?.scope != null,
    };
  }, [layers, path]);

  return useMemo((): t.EndpointRows => {
    const { collection, lower, stored, saved, overridden, isScope } = context;
    const names = items.map((item) => getEntryKey(item, NAME_KEY) ?? '');
    const rows = items.map((item, index): t.EndpointRow => {
      const value = isConfigRecord(item) ? item : {};
      const identity = getEntryKey(item, NAME_KEY);
      const origin = edit ? edit.origins[index] : undefined;
      const isNew = edit != null && origin === null;
      const loadedName = isNew ? undefined : (origin?.identity ?? identity);
      const fromLower = loadedName !== undefined && lower.has(loadedName);
      const storedEntry = loadedName === undefined ? undefined : stored.get(loadedName);
      const storedSecret = collection
        ? hasHiddenSecret(storedEntry, collection) || hasHiddenSecret(value, collection)
        : false;
      const savedEntry = loadedName === undefined ? undefined : saved.get(loadedName);
      let entryOrigin: t.EndpointOrigin = isScope ? 'scope' : 'admin';
      if (fromLower) entryOrigin = isScope ? 'inherited' : 'yaml';
      return {
        key: keys[index],
        index,
        value,
        title: getEntryTitle(item, index, localize),
        identity,
        loadedName,
        origin: entryOrigin,
        overridden: fromLower && loadedName !== undefined && overridden.has(loadedName),
        isNew,
        edited: !isNew && savedEntry !== undefined && !isConfigValueEqual(savedEntry, item),
        saved: savedEntry,
        host: endpointHost(value.baseURL),
        modelCount: modelNames(value).length,
        fetchesModels: fetchesModels(value),
        storedSecret,
        issues: validateEndpoint({
          entry: value,
          otherNames: names.filter((_, i) => i !== index),
          fromLowerLayer: fromLower,
          storedSecret,
          loadedName,
        }),
      };
    });
    const baselineIndex = new Map(
      (edit?.baseline ?? []).map((entry, index) => [getEntryKey(entry, NAME_KEY), index]),
    );
    const pendingOrigins = items.map((_, index) => {
      const identity = edit?.origins[index]?.identity;
      return identity === undefined ? Infinity : (baselineIndex.get(identity) ?? Infinity);
    });
    const removals = (edit?.detached ?? []).map((detached): t.EndpointRemoval => {
      const at = baselineIndex.get(detached.origin.identity);
      const index = at ?? items.length;
      const before = pendingOrigins.findIndex((origin) => origin > index);
      return {
        key: `removed-${detached.origin.identity}`,
        title: getEntryTitle(detached.value, at ?? 0, localize),
        value: detached.value,
        index,
        restoreIndex: before === -1 ? items.length : before,
      };
    });
    return {
      rows,
      removals,
      lowerEntry: (name) => lower.get(name),
    };
  }, [context, items, edit, keys, localize]);
}
