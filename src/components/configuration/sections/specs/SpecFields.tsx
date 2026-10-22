import { useContext, useId } from 'react';
import { ButtonGroup } from '@clickhouse/click-ui';
import { EModelEndpoint } from 'librechat-data-provider';
import type * as t from '@/types';
import { problemAt, specEndpoint, SPEC_LIST_PATH } from './validation';
import { CollectionEditsContext } from '@/contexts/CollectionEditsContext';
import { useLocalize, useOptionSources } from '@/hooks';
import { endpointGroups, mcpGroups } from './groups';
import { TextField } from '../../fields/TextField';
import { describeField, labelForPath } from '../../meta';
import { GroupedSelect } from './GroupedSelect';
import { ASSISTANT_ENDPOINTS } from './params';
import { SpecFieldRow } from './SpecFieldRow';
import { toFieldId } from '../../renderer';
import { uniqueOptions } from './options';
import { ChipPicker } from './ChipPicker';
import { useSpecList } from './context';
import { SpecIcon } from './SpecIcon';
import { isConfigRecord } from '@/utils';

function textOf(value: t.ConfigValue): string {
  return typeof value === 'string' ? value : '';
}

/** "OpenAI GPT-5" → "openai-gpt-5", made unique among the other specs' names. */
export function slugify(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'spec';
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function otherNames(items: t.ConfigValue[], index: number): Set<string> {
  return new Set(
    items.flatMap((item, i) =>
      i !== index && isConfigRecord(item) && typeof item.name === 'string' ? [item.name] : [],
    ),
  );
}

/** A spec added in this session (its name isn't one the list was loaded with). */
function useIsNewSpec(spec: t.ConfigRecord): boolean {
  const { savedNames } = useSpecList();
  return !savedNames.has(textOf(spec.name));
}

function useRowLabel(path: string, field?: t.SchemaField) {
  const localize = useLocalize();
  return {
    label: labelForPath(path, localize),
    description: field ? describeField(field, localize) : undefined,
  };
}

/**
 * Label*: the name the model menu shows. On a new spec whose name still
 * follows the label, the name is derived from it ("GPT 5 mini" → "gpt-5-mini").
 */
export function LabelField({ field, spec, index, path, onChange, disabled }: t.SpecFieldProps) {
  const { items, problems, savedNames } = useSpecList();
  const isNew = useIsNewSpec(spec);
  const dataPath = `${path}.label`;
  const { label, description } = useRowLabel(dataPath, field);
  const name = textOf(spec.name);
  const followsLabel =
    !savedNames.has(name) &&
    (name === '' || name === slugify(textOf(spec.label), otherNames(items, index)));
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      required
      problem={problemAt(problems, index, 'label')}
      quietWhenEmpty={isNew && textOf(spec.label).trim() === ''}
      control={
        <TextField
          id={toFieldId(dataPath)}
          value={textOf(spec.label)}
          required
          hasRowError={problemAt(problems, index, 'label') != null}
          disabled={disabled}
          onChange={(next) => {
            onChange('label', next);
            if (followsLabel && next.trim() !== '') {
              onChange('name', slugify(next, otherNames(items, index)));
            }
          }}
        />
      }
    />
  );
}

/**
 * The name a spec was loaded with in this edit session: its pending edit's
 * origin, or its current name while the list has no pending edit (so it
 * follows saves, Discard and scope changes). Undefined for a spec added since.
 */
function useLoadedName(spec: t.ConfigRecord, index: number): string | undefined {
  const edit = useContext(CollectionEditsContext)[SPEC_LIST_PATH];
  return edit ? edit.origins[index]?.identity : textOf(spec.name);
}

/** Name*: the id conversations and `?spec=` links use; renaming a saved spec says what it breaks. */
export function NameField({ field, spec, index, path, onChange, disabled }: t.SpecFieldProps) {
  const localize = useLocalize();
  const { problems, savedNames } = useSpecList();
  const isNew = useIsNewSpec(spec);
  const loadedName = useLoadedName(spec, index);
  const dataPath = `${path}.name`;
  const { label, description } = useRowLabel(dataPath, field);
  const problem = problemAt(problems, index, 'name');
  const renamed =
    loadedName !== undefined &&
    loadedName !== '' &&
    savedNames.has(loadedName) &&
    textOf(spec.name) !== loadedName;
  const warningId = `${toFieldId(dataPath)}-rename`;
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      required
      problem={problem}
      quietWhenEmpty={isNew && textOf(spec.name).trim() === ''}
      control={
        <>
          <TextField
            id={toFieldId(dataPath)}
            value={textOf(spec.name)}
            required
            hasRowError={problem != null}
            disabled={disabled}
            aria-describedby={renamed ? warningId : undefined}
            onChange={(next) => onChange('name', next)}
          />
          {renamed && (
            <p id={warningId} className="m-0 text-xs text-(--settings-warn-fg)">
              {localize('com_config_specs_rename_warning', { name: loadedName })}
            </p>
          )}
        </>
      }
    />
  );
}

/** Icon: an image URL or a provider name, with a preview of what the model menu shows. */
export function IconField({
  field,
  spec,
  path,
  onChange,
  disabled,
  keyName = 'iconURL',
}: t.SpecIconFieldProps) {
  const localize = useLocalize();
  const listId = useId();
  const { options } = useSpecList();
  const dataPath = `${path}.${keyName}`;
  const { label, description } = useRowLabel(dataPath, field);
  const value = textOf(spec[keyName]);
  const title = textOf(keyName === 'groupIcon' ? spec.group : spec.label) || label;
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      width="L"
      control={
        <div className="flex items-center gap-2">
          <SpecIcon iconURL={value} label={title} size="md" />
          <TextField
            id={toFieldId(dataPath)}
            value={value}
            list={listId}
            disabled={disabled}
            width="L"
            placeholder={localize('com_config_specs_icon_placeholder')}
            onChange={(next) => onChange(keyName, next)}
            onClear={() => {
              onChange(keyName, undefined);
              return true;
            }}
          />
          <datalist id={listId}>
            {options.endpoints
              .filter((option) => !options.customEndpoints.has(option.value))
              .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
          </datalist>
        </div>
      }
    />
  );
}

/** Group: a group the other specs use, an endpoint name (nests the spec under it), or a new name. */
export function GroupField({
  field,
  spec,
  path,
  onChange,
  disabled,
}: Omit<t.SpecFieldProps, 'index'>) {
  const localize = useLocalize();
  const listId = useId();
  const { options } = useSpecList();
  const dataPath = `${path}.group`;
  const { label, description } = useRowLabel(dataPath, field);
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      control={
        <>
          <TextField
            id={toFieldId(dataPath)}
            value={textOf(spec.group)}
            list={listId}
            disabled={disabled}
            placeholder={localize('com_config_ctl_ref_placeholder')}
            onChange={(next) => onChange('group', next)}
            onClear={() => {
              onChange('group', undefined);
              return true;
            }}
          />
          <datalist id={listId}>
            {options.groups.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </datalist>
        </>
      }
    />
  );
}

/**
 * Endpoint*: a built-in provider or a custom endpoint; one the configuration
 * lacks is flagged. A preset naming only an agent shows the agents endpoint
 * LibreChat infers for it. Leaving the agents endpoint clears the agent ID,
 * and leaving the assistants endpoints the assistant ID: only those specs
 * use (and show) them.
 */
export function EndpointField({
  field,
  spec,
  index,
  path,
  onPresetChange,
  disabled,
}: t.SpecPresetFieldProps) {
  const localize = useLocalize();
  const { options, problems } = useSpecList();
  const dataPath = `${path}.preset.endpoint`;
  const { label, description } = useRowLabel(dataPath, field);
  const preset = isConfigRecord(spec.preset) ? spec.preset : {};
  const endpoint = specEndpoint(spec);
  const problem = problemAt(problems, index, 'preset.endpoint');
  const isNew = useIsNewSpec(spec);
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      required
      problem={problem}
      quietWhenEmpty={isNew && endpoint === ''}
      control={
        <GroupedSelect
          id={toFieldId(dataPath)}
          value={endpoint || undefined}
          groups={endpointGroups(options, localize)}
          required
          disabled={disabled}
          placeholder={localize('com_config_specs_endpoint_placeholder')}
          unknownLabel={(name) => localize('com_config_specs_not_configured', { name })}
          aria-describedby={
            problem?.level === 'warning' ? `${toFieldId(dataPath)}-warning` : undefined
          }
          onChange={(next) => {
            onPresetChange('endpoint', next);
            if (next !== EModelEndpoint.agents && preset.agent_id !== undefined) {
              onPresetChange('agent_id', undefined);
            }
            if (!ASSISTANT_ENDPOINTS.has(next) && preset.assistant_id !== undefined) {
              onPresetChange('assistant_id', undefined);
            }
          }}
        />
      }
    />
  );
}

/** Model*: free text with the endpoint's known models suggested (fetched models can't be listed here). */
export function ModelField({
  field,
  spec,
  index,
  path,
  onPresetChange,
  disabled,
}: t.SpecPresetFieldProps) {
  const localize = useLocalize();
  const listId = useId();
  const { options, problems } = useSpecList();
  const preset = isConfigRecord(spec.preset) ? spec.preset : {};
  const endpoint = specEndpoint(spec);
  const source = useOptionSources(endpoint ? `models:${endpoint}` : undefined);
  const suggestions = uniqueOptions([...options.modelsFor(endpoint), ...source.options]);
  const dataPath = `${path}.preset.model`;
  const { label, description } = useRowLabel(dataPath, field);
  const problem = problemAt(problems, index, 'preset.model');
  const isNew = useIsNewSpec(spec);
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      required
      problem={problem}
      quietWhenEmpty={isNew && textOf(preset.model).trim() === ''}
      control={
        <>
          <TextField
            id={toFieldId(dataPath)}
            value={textOf(preset.model)}
            list={listId}
            required
            hasRowError={problem != null}
            disabled={disabled}
            placeholder={localize('com_config_specs_model_placeholder')}
            onChange={(next) => onPresetChange('model', next)}
          />
          <datalist id={listId}>
            {suggestions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </datalist>
        </>
      }
    />
  );
}

/** Agent ID*: the agent an agents-endpoint spec runs (its model comes from the agent). */
export function AgentField({
  field,
  spec,
  index,
  path,
  onPresetChange,
  disabled,
}: t.SpecPresetFieldProps) {
  const { problems } = useSpecList();
  const preset = isConfigRecord(spec.preset) ? spec.preset : {};
  const dataPath = `${path}.preset.agent_id`;
  const { label, description } = useRowLabel(dataPath, field);
  const problem = problemAt(problems, index, 'preset.agent_id');
  const isNew = useIsNewSpec(spec);
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      required
      problem={problem}
      quietWhenEmpty={isNew && textOf(preset.agent_id).trim() === ''}
      control={
        <TextField
          id={toFieldId(dataPath)}
          value={textOf(preset.agent_id)}
          required
          hasRowError={problem != null}
          disabled={disabled}
          onChange={(next) => onPresetChange('agent_id', next)}
        />
      }
    />
  );
}

const DEFAULT_KINDS: readonly t.SpecDefaultKind[] = ['none', 'soft', 'default'];

/** Default for new chats: No, Soft default or Default; choosing one moves it off any other spec. */
export function DefaultField({ spec, index, path, disabled }: Omit<t.SpecFieldProps, 'onChange'>) {
  const localize = useLocalize();
  const { problems, actions } = useSpecList();
  const dataPath = `${path}.default`;
  const kind: t.SpecDefaultKind = (() => {
    if (spec.default === true) return 'default';
    return spec.softDefault === true ? 'soft' : 'none';
  })();
  const problem =
    problemAt(problems, index, 'default') ?? problemAt(problems, index, 'softDefault');
  const label = localize('com_config_specs_default');
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={localize('com_config_specs_default_desc')}
      problem={problem}
      matchPaths={[`${path}.softDefault`]}
      control={
        <ButtonGroup
          id={toFieldId(dataPath)}
          aria-label={label}
          className="max-w-full self-start"
          options={DEFAULT_KINDS.map((value) => ({
            value,
            label: localize(`com_config_specs_default_${value}`),
            disabled,
          }))}
          selected={kind}
          onClick={(next) => {
            if (disabled || next === kind) return;
            actions.setDefault(index, next as t.SpecDefaultKind);
          }}
        />
      }
    />
  );
}

/** MCP servers: picked from the servers the configuration defines. */
export function McpField({
  field,
  spec,
  path,
  onChange,
  disabled,
}: Omit<t.SpecFieldProps, 'index'>) {
  const localize = useLocalize();
  const { options } = useSpecList();
  const dataPath = `${path}.mcpServers`;
  const { label, description } = useRowLabel(dataPath, field);
  const values = Array.isArray(spec.mcpServers)
    ? spec.mcpServers.filter((item): item is string => typeof item === 'string')
    : [];
  return (
    <SpecFieldRow
      path={dataPath}
      label={label}
      description={description}
      width="L"
      control={
        <ChipPicker
          id={toFieldId(dataPath)}
          values={values}
          groups={mcpGroups(options, localize)}
          disabled={disabled}
          onChange={(next) => onChange('mcpServers', next)}
          onClear={() => {
            onChange('mcpServers', undefined);
            return true;
          }}
          addLabel={localize('com_config_specs_mcp_add')}
          unknownLabel={(name) => localize('com_config_specs_not_configured', { name })}
          aria-label={label}
        />
      }
    />
  );
}
