import type * as t from '@/types';
import { stripInterfacePermissionFields, isConfigRecord } from '@/utils';
import { APP_SERVICE_KEY_ALIASES } from '@/constants';

/** Keys LibreChat's `azureConfigSetup` derives from `groups`; they are not settings. */
const AZURE_OPENAI_DERIVED_KEYS = new Set([
  'assistantGroups',
  'errors',
  'isValid',
  'groupMap',
  'modelNames',
  'modelGroupMap',
  'assistantModels',
  'serverless',
  'instanceName',
  'deploymentName',
]);

/** Keys LibreChat's endpoint setup adds to the Anthropic block (`vertexConfig` from `vertex`). */
const ANTHROPIC_DERIVED_KEYS = new Set(['vertexConfig']);

function withoutKeys(value: t.ConfigRecord, keys: ReadonlySet<string>): t.ConfigRecord {
  const cleaned: t.ConfigRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (!keys.has(key)) cleaned[key] = child;
  }
  return cleaned;
}

/**
 * The Azure OpenAI block as configured: derived keys dropped and `groups`
 * rebuilt from `groupMap`, which is what LibreChat serves. A stored `groups`
 * override is not re-processed by LibreChat (it only runs `azureConfigSetup`
 * on librechat.yaml), so the live `groupMap` wins over it (D13): the table
 * shows what users get, and the stale override is flagged separately.
 */
function normalizeAzureOpenAI(value: t.ConfigRecord): t.ConfigRecord {
  const cleaned = withoutKeys(value, AZURE_OPENAI_DERIVED_KEYS);
  const { groupMap } = value;
  if (!isConfigRecord(groupMap)) return cleaned;
  cleaned.groups = Object.entries(groupMap).map(([group, config]) => ({
    group,
    ...(isConfigRecord(config) ? config : {}),
  }));
  return cleaned;
}

/**
 * One endpoint block of LibreChat's processed AppConfig, mapped back to the
 * configuration it came from: the processed Azure OpenAI block (`groupMap`
 * and `isValid` present) and the Anthropic block's `vertexConfig`.
 */
export function normalizeEndpointValue(value: t.ConfigValue, key?: string): t.ConfigValue {
  if (!isConfigRecord(value)) return value;
  if ('groupMap' in value && 'isValid' in value) return normalizeAzureOpenAI(value);
  if (key === 'anthropic' && 'vertexConfig' in value) {
    return withoutKeys(value, ANTHROPIC_DERIVED_KEYS);
  }
  return value;
}

/** Maps AppService output back to canonical config keys and drops derived endpoint state. */
export function normalizeAppServiceKeys(
  raw: Record<string, t.ConfigValue>,
): Record<string, t.ConfigValue> {
  const result: Record<string, t.ConfigValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    result[APP_SERVICE_KEY_ALIASES[key] ?? key] = value;
  }
  if (isConfigRecord(result.interface)) {
    result.interface = stripInterfacePermissionFields(
      result.interface as Record<string, unknown>,
    ) as t.ConfigValue;
  }
  if (isConfigRecord(result.endpoints)) {
    const endpoints = { ...result.endpoints };
    result.endpoints = endpoints;
    for (const [epKey, epValue] of Object.entries(endpoints)) {
      endpoints[epKey] = normalizeEndpointValue(epValue, epKey);
    }
  }
  return result;
}
