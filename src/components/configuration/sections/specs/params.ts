import { EModelEndpoint, paramSettings, getSettingsKeys } from 'librechat-data-provider';
import type { SettingDefinition } from 'librechat-data-provider';
import type * as t from '@/types';
import { isConfigRecord, getValueAtPath } from '@/utils';
import { specEndpoint } from './validation';

/**
 * Preset keys that are conversation state or internal plumbing, never
 * something a spec should set (or that clash with a spec-level field of the
 * same name: the spec's own `iconURL` and `artifacts` are the ones used).
 */
export const PRESET_DENYLIST: ReadonlySet<string> = new Set([
  'archivedAt',
  'pinned',
  'isShared',
  'isTemporary',
  'tools',
  'subagentThread',
  'codeWorkspaces',
  'endpointType',
  'stream',
  'iconURL',
  'artifacts',
  'userLabel',
]);

/** Preset keys the editor shows in its own groups (Model, Prompt), not among the parameters. */
export const MODEL_KEYS: readonly string[] = ['endpoint', 'model', 'modelLabel', 'agent_id'];
export const PROMPT_KEYS: readonly string[] = [
  'promptPrefix',
  'system',
  'instructions',
  'additional_instructions',
  'greeting',
];
const GROUPED_KEYS: ReadonlySet<string> = new Set([...MODEL_KEYS, ...PROMPT_KEYS]);
const GREETING_KEY = 'greeting';
/** Prompt fields only the assistants endpoints use (shown elsewhere only when set). */
const ASSISTANT_PROMPT_KEYS: ReadonlySet<string> = new Set([
  'instructions',
  'additional_instructions',
]);

const BUILT_IN: ReadonlySet<string> = new Set(Object.values(EModelEndpoint));
export const ASSISTANT_ENDPOINTS: ReadonlySet<string> = new Set([
  EModelEndpoint.assistants,
  EModelEndpoint.azureAssistants,
]);

function paramKind(setting: SettingDefinition): t.PresetParamKind | null {
  if (setting.type === 'boolean') return 'boolean';
  if (setting.type === 'number') return 'number';
  if (setting.type === 'array') return 'list';
  if (setting.type === 'enum') return 'enum';
  if (setting.type === 'string') return setting.component === 'textarea' ? 'textarea' : 'text';
  return null;
}

function toParam(setting: SettingDefinition): t.PresetParam | null {
  const kind = paramKind(setting);
  if (!kind) return null;
  const param: t.PresetParam = { key: setting.key, kind };
  if (setting.range) {
    param.min = setting.range.min;
    param.max = setting.range.max;
    if (setting.range.step !== undefined) param.step = setting.range.step;
  }
  if (kind === 'enum' && setting.options) {
    param.options = setting.options.filter((option) => option !== '');
  }
  const fallback = setting.default;
  const isEmptyDefault = fallback === '' || (Array.isArray(fallback) && fallback.length === 0);
  if (fallback !== undefined && !isEmptyDefault) param.defaultValue = fallback;
  return param;
}

/**
 * The endpoint type LibreChat resolves parameters by: a built-in provider is
 * its own type; any other name is a custom endpoint, whose parameters follow
 * its `customParams.defaultParamsEndpoint` when set.
 */
function settingsEndpoint(endpoint: string, custom: t.ConfigRecord | undefined): string {
  if (BUILT_IN.has(endpoint)) return endpoint;
  const customParams = isConfigRecord(custom?.customParams) ? custom.customParams : undefined;
  const defaultParams = customParams?.defaultParamsEndpoint;
  return typeof defaultParams === 'string' && defaultParams !== ''
    ? defaultParams
    : EModelEndpoint.custom;
}

/**
 * The model parameters a spec's preset can set for its endpoint and model,
 * from LibreChat's own parameter panel settings (`paramSettings`): the model
 * family key first (`bedrock-anthropic`), else the endpoint's. The Model and
 * Prompt fields are left out (the editor shows them in their own groups), and
 * so are parameters the preset schema can't store.
 */
export function presetParams(
  endpoint: string,
  model: string,
  custom: t.ConfigRecord | undefined,
  presetKeys: ReadonlySet<string>,
): t.PresetParamSet {
  if (!endpoint) return { settingsKey: null, params: [] };
  const type = settingsEndpoint(endpoint, custom);
  const [combinedKey, endpointKey] = getSettingsKeys(type, model);
  const settingsKey = paramSettings[combinedKey] ? combinedKey : endpointKey;
  const settings = paramSettings[settingsKey];
  if (!settings) return { settingsKey: null, params: [] };
  const params = settings.flatMap((setting) => {
    if (GROUPED_KEYS.has(setting.key) || !presetKeys.has(setting.key)) return [];
    const param = toParam(setting);
    return param ? [param] : [];
  });
  return { settingsKey, params };
}

/** The prompt field an endpoint's parameter panel uses (`system` for Bedrock's Anthropic models). */
export function promptKeyFor(endpoint: string, model: string, custom?: t.ConfigRecord): string {
  if (!endpoint) return 'promptPrefix';
  const type = settingsEndpoint(endpoint, custom);
  const [combinedKey, endpointKey] = getSettingsKeys(type, model);
  const settings = paramSettings[combinedKey] ?? paramSettings[endpointKey] ?? [];
  return settings.some((setting) => setting.key === 'system') ? 'system' : 'promptPrefix';
}

function isSet(value: t.ConfigValue): boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * The prompt fields a spec's editor shows, in order: the prompt field of its
 * endpoint's parameter panel (`promptKeyFor`), the greeting, the assistants'
 * instructions on an assistants endpoint, and any other prompt field the
 * preset already sets (so a stale value stays visible and removable).
 */
export function specPromptKeys(
  preset: t.ConfigRecord,
  endpoint: string,
  custom?: t.ConfigRecord,
): string[] {
  const model = typeof preset.model === 'string' ? preset.model : '';
  const promptKey = promptKeyFor(endpoint, model, custom);
  const isAssistant = ASSISTANT_ENDPOINTS.has(endpoint);
  return [
    promptKey,
    GREETING_KEY,
    ...PROMPT_KEYS.filter(
      (key) =>
        key !== promptKey &&
        key !== GREETING_KEY &&
        ((isAssistant && ASSISTANT_PROMPT_KEYS.has(key)) || isSet(preset[key])),
    ),
  ];
}

/** A schema field with a parameter's range and choices, so the shared control enforces them. */
export function paramField(field: t.SchemaField, param: t.PresetParam): t.SchemaField {
  if (param.kind === 'enum' && param.options?.length) {
    return { ...field, type: `enum(${param.options.join(' | ')})` };
  }
  if (param.kind !== 'number' || (param.min === undefined && param.max === undefined)) {
    return field;
  }
  return {
    ...field,
    constraints: {
      ...field.constraints,
      ...(param.min !== undefined && { min: param.min }),
      ...(param.max !== undefined && { max: param.max }),
      ...(param.step !== undefined && { step: param.step }),
    },
  };
}

/** A custom endpoint's settings by name, from the whole configuration. */
function customEndpointOf(root: t.ConfigValue, name: string): t.ConfigRecord | undefined {
  const custom = getValueAtPath(root, 'endpoints.custom');
  const entry = Array.isArray(custom)
    ? custom.find((item) => isConfigRecord(item) && item.name === name)
    : undefined;
  return isConfigRecord(entry) ? entry : undefined;
}

/**
 * A spec's fields as its editor shows them, for search: the preset narrowed
 * to the Model fields, the Prompt fields the editor shows for its endpoint
 * (`specPromptKeys`), its endpoint's parameters, and whatever else the preset
 * sets (so neither "Thinking budget" nor "System prompt" is found on an
 * OpenAI spec).
 */
export function specSearchFields(
  fields: t.SchemaField[],
  spec: t.ConfigValue,
  root: t.ConfigValue,
): t.SchemaField[] {
  const preset = isConfigRecord(spec) && isConfigRecord(spec.preset) ? spec.preset : {};
  return fields.map((field) => {
    if (field.key !== 'preset' || !field.children) return field;
    const presetKeys = new Set(field.children.map((child) => child.key));
    const endpoint = specEndpoint(spec);
    const model = typeof preset.model === 'string' ? preset.model : '';
    const custom = customEndpointOf(root, endpoint);
    const shown = new Set([
      ...MODEL_KEYS,
      ...specPromptKeys(preset, endpoint, custom),
      ...presetParams(endpoint, model, custom, presetKeys).params.map((param) => param.key),
      ...Object.keys(preset),
    ]);
    return { ...field, children: field.children.filter((child) => shown.has(child.key)) };
  });
}
