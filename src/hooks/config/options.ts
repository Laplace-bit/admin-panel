import { useContext, useMemo } from 'react';
import { normalizeEndpointName } from 'librechat-data-provider';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import type * as t from '@/types';
import {
  toolOptionsQuery,
  baseConfigOptions,
  endpointStatusOptions,
  endpointModelsOptions,
} from '@/server';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { MODEL_PROVIDERS, BUILT_IN_PROVIDERS } from '@/constants';
import { getValueAtPath, isConfigRecord } from '@/utils';
import { useLocalize } from '../useLocalize';
import { useFieldState } from './field';

const NO_OPTIONS: t.SelectOption[] = [];
const MODELS_PREFIX = 'models:';
const BUILT_IN_SET: ReadonlySet<string> = new Set(BUILT_IN_PROVIDERS);
/** Built-in endpoints that delegate to a provider (agents, Assistants) rather than run models. */
const NON_PROVIDERS: ReadonlySet<string> = new Set(
  BUILT_IN_PROVIDERS.filter((name) => !MODEL_PROVIDERS.includes(name)),
);

let inertClient: QueryClient | null = null;

/**
 * The page's query client, or an idle one where none is provided (isolated
 * component tests): queries are then disabled and nothing is fetched.
 */
function useClient(): { client: QueryClient; live: boolean } {
  const provided = useContext(QueryClientContext);
  if (provided) return { client: provided, live: true };
  inertClient ??= new QueryClient();
  return { client: inertClient, live: false };
}

/** When the base configuration was last loaded: saves refetch it, and endpoint data follows. */
function useConfigVersion(client: QueryClient, live: boolean): number {
  const { dataUpdatedAt } = useQuery(
    { ...baseConfigOptions, enabled: false, notifyOnChangeProps: ['dataUpdatedAt'] },
    client,
  );
  return live ? dataUpdatedAt : 0;
}

/** Enabled endpoints from LibreChat (`/api/endpoints`), refetched after each save. */
export function useEndpointStatus(): t.QueryState<t.EndpointStatusMap> {
  const { client, live } = useClient();
  const version = useConfigVersion(client, live);
  const query = useQuery(
    { ...endpointStatusOptions(version), enabled: live, placeholderData: (prev) => prev },
    client,
  );
  return { data: query.data, isLoading: live && query.isLoading, isError: query.isError };
}

/** Model names per endpoint from LibreChat (`/api/models`), refetched after each save. */
export function useEndpointModels(enabled = true): t.QueryState<t.EndpointModelsMap> {
  const { client, live } = useClient();
  const version = useConfigVersion(client, live);
  const query = useQuery(
    {
      ...endpointModelsOptions(version),
      enabled: live && enabled,
      placeholderData: (prev) => prev,
    },
    client,
  );
  return {
    data: query.data,
    isLoading: live && enabled && query.isLoading,
    isError: query.isError,
  };
}

/** Distinct names of an `endpoints.custom` list. */
function customEndpointNames(list: t.ConfigValue | undefined): string[] {
  if (!Array.isArray(list)) return [];
  const names = new Set<string>();
  for (const entry of list) {
    const name = isConfigRecord(entry) ? entry.name : undefined;
    if (typeof name === 'string' && name.trim() !== '') names.add(name);
  }
  return [...names];
}

/** The configuration shown on the page (pending edits included), or the effective one. */
function useShownConfig(): t.ConfigValue {
  const values = useContext(ConfigValuesContext);
  return values?.configValues ?? values?.layers?.effective ?? null;
}

/** Custom endpoint names in the shown configuration (pending edits included). */
export function useCustomEndpointNames(): string[] {
  const root = useShownConfig();
  const list = getValueAtPath(root, 'endpoints.custom');
  return useMemo(() => customEndpointNames(list), [list]);
}

/**
 * Endpoint choices: the endpoints LibreChat serves (built-in providers named
 * "OpenAI (openAI)"), then built-in providers and custom endpoints the
 * configuration defines but LibreChat does not serve (not enabled, or not
 * saved yet), so a reference to any of them is recognized. Each value is the
 * name LibreChat serves the endpoint under, since `addedEndpoints` and
 * `allowedProviders` are matched against it exactly: a custom endpoint
 * written "Ollama" is offered as "Ollama (ollama)". Names that differ only
 * in letter case are distinct endpoints and are both offered. With
 * `providersOnly`, endpoints that delegate to a provider (agents, Assistants)
 * are left out.
 */
export function buildEndpointOptions(
  status: t.EndpointStatusMap | undefined,
  root: t.ConfigValue,
  localize: t.LocalizeFn,
  providersOnly = false,
): t.SelectOption[] {
  const configured = customEndpointNames(getValueAtPath(root, 'endpoints.custom'));
  const spelling = new Map<string, string>();
  for (const name of configured) {
    const served = normalizeEndpointName(name);
    if (!spelling.has(served)) spelling.set(served, name);
  }
  const seen = new Set<string>();
  const options: t.SelectOption[] = [];
  const add = (name: string) => {
    const served = BUILT_IN_SET.has(name) ? name : normalizeEndpointName(name);
    if (seen.has(served) || (providersOnly && NON_PROVIDERS.has(served))) return;
    seen.add(served);
    const label = BUILT_IN_SET.has(served)
      ? localize(`com_config_field_${served}`)
      : (spelling.get(served) ?? served);
    options.push({ value: served, label: label === served ? served : `${label} (${served})` });
  };
  for (const name of Object.keys(status ?? {})) add(name);
  for (const name of BUILT_IN_PROVIDERS) add(name);
  for (const name of configured) add(name);
  return options;
}

/** An endpoint's models, matching LibreChat's normalized names (`Ollama` is served as `ollama`). */
function modelsOf(models: t.EndpointModelsMap | undefined, endpoint: string): string[] | undefined {
  if (!models) return undefined;
  return models[endpoint] ?? models[normalizeEndpointName(endpoint)];
}

function recordKeys(root: t.ConfigValue, path: string): string[] {
  const value = getValueAtPath(root, path);
  return isConfigRecord(value) ? Object.keys(value) : [];
}

/** Distinct `group` names of the model specs list. */
function specGroups(root: t.ConfigValue): string[] {
  const list = getValueAtPath(root, 'modelSpecs.list');
  if (!Array.isArray(list)) return [];
  const groups = new Set<string>();
  for (const spec of list) {
    const group = isConfigRecord(spec) ? spec.group : undefined;
    if (typeof group === 'string' && group.trim() !== '') groups.add(group);
  }
  return [...groups];
}

function toOptions(values: string[]): t.SelectOption[] {
  return values.map((value) => ({ value, label: value }));
}

/**
 * Options for a reference select (WS9; consumed by WS3's RefSelectField and
 * the area editors):
 * - `endpoints`: endpoints LibreChat serves, plus every configured one;
 * - `providers`: the same without agents and the Assistants endpoints;
 * - `models:<endpoint>`: that endpoint's models from `/api/models`;
 * - `mcpServers`: MCP server names in the shown configuration;
 * - `specGroups`: group names used by the model specs list;
 * - `tools`: tools agents can use (`/api/agents/tools`).
 * Configuration-derived sources include pending edits. Server data is
 * refetched after each save; outside a query client only the configuration
 * applies.
 */
export function useOptionSources(source?: t.OptionSource): t.OptionSourceResult {
  const localize = useLocalize();
  const root = useShownConfig();
  const { client, live } = useClient();
  const version = useConfigVersion(client, live);
  const wantsStatus = source === 'endpoints' || source === 'providers';
  const wantsModels = source?.startsWith(MODELS_PREFIX) ?? false;
  const wantsTools = source === 'tools';
  const status = useQuery(
    {
      ...endpointStatusOptions(version),
      enabled: live && wantsStatus,
      placeholderData: (prev) => prev,
    },
    client,
  );
  const models = useQuery(
    {
      ...endpointModelsOptions(version),
      enabled: live && wantsModels,
      placeholderData: (prev) => prev,
    },
    client,
  );
  const tools = useQuery({ ...toolOptionsQuery, enabled: live && wantsTools }, client);

  const options = useMemo((): t.SelectOption[] => {
    if (!source) return NO_OPTIONS;
    if (source === 'endpoints' || source === 'providers') {
      return buildEndpointOptions(status.data, root, localize, source === 'providers');
    }
    if (source === 'mcpServers') return toOptions(recordKeys(root, 'mcpServers'));
    if (source === 'specGroups') return toOptions(specGroups(root));
    if (source === 'tools') return tools.data ?? NO_OPTIONS;
    const endpoint = source.slice(MODELS_PREFIX.length);
    return toOptions(modelsOf(models.data, endpoint) ?? []);
  }, [source, status.data, models.data, tools.data, root, localize]);

  const isLoading =
    live &&
    ((wantsStatus && status.isLoading) ||
      (wantsModels && models.isLoading) ||
      (wantsTools && tools.isLoading));
  return { options, isLoading };
}

/**
 * Defaults and suggestions for a model list field (AP-2): the models
 * `/api/models` lists for the source's endpoint. They are the provider's
 * defaults only while the saved configuration sets no list (the API returns
 * the configured list otherwise), so `defaults` is left out then.
 */
export function useModelListDefaults(
  path: string,
  source: t.OptionSource | undefined,
): t.ModelListDefaults {
  const endpoint = source?.startsWith(MODELS_PREFIX) ? source.slice(MODELS_PREFIX.length) : null;
  const models = useEndpointModels(endpoint != null);
  const state = useFieldState(path);
  return useMemo(() => {
    const list = endpoint ? modelsOf(models.data, endpoint) : undefined;
    if (!list) return { suggestions: [] };
    const savedList = state.isOverride || Array.isArray(state.effective);
    return savedList ? { suggestions: list } : { defaults: list, suggestions: list };
  }, [endpoint, models.data, state.isOverride, state.effective]);
}

/** Siblings that name the endpoint a model field's model runs on, nearest first. */
const MODEL_ENDPOINT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  titleModel: ['titleEndpoint'],
  activityModel: ['activityEndpoint'],
  activityPhaseModel: ['activityPhaseEndpoint', 'activityEndpoint'],
  reasoningLabelModel: ['reasoningLabelEndpoint', 'activityEndpoint'],
};

/**
 * The option source of a model field (AP-9): the models of the endpoint its
 * sibling names (`titleModel` → `titleEndpoint`), pending edits included, else
 * `source` (the field's own provider). Other sources pass through.
 */
export function useModelSource(
  source: t.OptionSource | undefined,
  path: string | undefined,
): t.OptionSource | undefined {
  const root = useShownConfig();
  if (!path || !source?.startsWith(MODELS_PREFIX)) return source;
  const dot = path.lastIndexOf('.');
  const siblings = MODEL_ENDPOINT_FIELDS[path.slice(dot + 1)] ?? [];
  for (const sibling of siblings) {
    const endpoint = getValueAtPath(root, `${path.slice(0, dot)}.${sibling}`);
    if (typeof endpoint === 'string' && endpoint.trim() !== '') return `models:${endpoint}`;
  }
  return source;
}
