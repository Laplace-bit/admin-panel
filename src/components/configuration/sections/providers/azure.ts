import type * as t from '@/types';
import { isConfigRecord, isEnvReference } from '@/utils';

function text(value: t.ConfigValue): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function stringRecord(value: t.ConfigValue): Record<string, string> | undefined {
  if (!isConfigRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** A group's models: `name: true` (deployed under its own name) or per-model overrides. */
function toModels(value: t.ConfigValue): t.AzureGroupModel[] {
  if (!isConfigRecord(value)) return [];
  return Object.entries(value).map(([name, config]) => {
    if (!isConfigRecord(config)) return { name };
    return {
      name,
      deploymentName: text(config.deploymentName),
      version: text(config.version),
      assistants: config.assistants === true ? true : undefined,
    };
  });
}

/**
 * The Azure OpenAI groups as the read-only table shows them (AP-1, D13),
 * from the normalized `endpoints.azureOpenAI.groups`. LibreChat fills unset
 * values with `''` and `false`; blank text reads as unset.
 */
export function toAzureGroups(value: t.ConfigValue): t.AzureGroupRow[] {
  if (!Array.isArray(value)) return [];
  const rows: t.AzureGroupRow[] = [];
  for (const entry of value) {
    if (!isConfigRecord(entry) || typeof entry.group !== 'string') continue;
    rows.push({
      group: entry.group,
      apiKey: text(entry.apiKey),
      instanceName: text(entry.instanceName),
      baseURL: text(entry.baseURL),
      deploymentName: text(entry.deploymentName),
      version: text(entry.version),
      serverless: entry.serverless === true,
      assistants: entry.assistants === true,
      models: toModels(entry.models),
      additionalHeaders: stringRecord(entry.additionalHeaders),
      addParams: isConfigRecord(entry.addParams) ? entry.addParams : undefined,
      dropParams: Array.isArray(entry.dropParams)
        ? entry.dropParams.filter((param): param is string => typeof param === 'string')
        : undefined,
    });
  }
  return rows;
}

const ENV_NAME = /^\$\{([A-Za-z0-9_]+)\}$/;

/**
 * How a credential is shown: an environment reference (`${EASTUS_API_KEY}`)
 * by its variable name, any literal value hidden.
 */
export function maskCredential(value: string | undefined): t.MaskedCredential {
  if (!value) return { kind: 'none' };
  const match = isEnvReference(value) ? ENV_NAME.exec(value) : null;
  if (match) return { kind: 'env', name: match[1] };
  return { kind: 'masked' };
}
