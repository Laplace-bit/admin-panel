import { useMemo, useRef, useCallback } from 'react';
import { EModelEndpoint } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  NameField,
  McpField,
  IconField,
  ModelField,
  AgentField,
  LabelField,
  GroupField,
  DefaultField,
  EndpointField,
} from './SpecFields';
import { isAgentSpec, problemsOf, specEndpoint } from './validation';
import { UnknownSettings } from '../../UnknownSettings';
import { renderInlineField } from '../../renderer';
import { PresetEditor } from './PresetEditor';
import { useSpecList, specIndexOf } from './context';
import { useLocalize } from '@/hooks';
import { SpecGroup } from './SpecGroup';
import { promptKeyFor } from './params';
import { isConfigRecord } from '@/utils';

const BASICS = ['label', 'name', 'description', 'iconURL'];
const CAPABILITIES = [
  'webSearch',
  'fileSearch',
  'executeCode',
  'memory',
  'askUserQuestion',
  'artifacts',
  'runInBackground',
  'describeIntent',
  'skills',
  'mcpServers',
];
const MENU = [
  'showInMenu',
  'group',
  'groupIcon',
  'showIconInMenu',
  'showIconInHeader',
  'showOnLanding',
  'hideBadgeRow',
  'conversation_starters',
];
const DEFAULTS = ['default', 'softDefault'];
const SUBAGENTS = 'subagents';
const ADVANCED = ['authType', 'order'];
const GROUPED: ReadonlySet<string> = new Set([
  ...BASICS,
  ...CAPABILITIES,
  ...MENU,
  ...DEFAULTS,
  ...ADVANCED,
  SUBAGENTS,
  'preset',
]);

const ASSISTANT_ENDPOINTS: ReadonlySet<string> = new Set([
  EModelEndpoint.assistants,
  EModelEndpoint.azureAssistants,
]);

function hasValue(value: t.ConfigValue): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return !isConfigRecord(value) || Object.keys(value).length > 0;
}

function countSet(record: t.ConfigRecord, keys: readonly string[]): number {
  return keys.filter((key) => hasValue(record[key])).length;
}

/**
 * Writes one key of an object field (`preset`, `subagents`), merged into its
 * latest value so two changes in one tick both land. An emptied optional
 * object is removed; the required preset stays an object.
 */
function useChildChange(
  parent: t.ConfigRecord,
  key: string,
  onChange: (key: string, value: t.ConfigValue) => void,
  keepEmpty: boolean,
) {
  const latest = useRef(parent);
  latest.current = parent;
  const change = useCallback(
    (childKey: string, childValue: t.ConfigValue) => {
      const next = { ...latest.current, [childKey]: childValue };
      if (childValue === undefined) delete next[childKey];
      latest.current = next;
      onChange(key, keepEmpty || Object.keys(next).length > 0 ? next : undefined);
    },
    [key, onChange, keepEmpty],
  );
  const replace = useCallback(
    (next: t.ConfigRecord) => {
      latest.current = next;
      onChange(key, next);
    },
    [key, onChange],
  );
  return { change, replace };
}

/**
 * The editor of one model spec (MS-1), in groups: Basics, Model, Parameters,
 * Prompt, Capabilities, Menu, New chats, Subagents and Advanced. Basics and
 * Model (with the required name, label, endpoint and model) open first;
 * other groups open for a problem or a search hit inside them. Fields the
 * schema adds later land in Advanced; keys the panel doesn't know are listed
 * read-only (D8).
 */
export function SpecEditor({
  fields,
  value,
  path,
  onChange,
  disabled,
  editSessionId,
}: t.SpecEditorProps) {
  const localize = useLocalize();
  const { problems, options, configuredOnly } = useSpecList();
  const index = specIndexOf(path);
  const spec = useMemo(() => (isConfigRecord(value) ? value : {}), [value]);
  const byKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
  const presetField = byKey.get('preset');
  const subagentsField = byKey.get(SUBAGENTS);
  const preset = isConfigRecord(spec.preset) ? spec.preset : {};
  const subagents = isConfigRecord(spec.subagents) ? spec.subagents : {};
  const presetChange = useChildChange(preset, 'preset', onChange, true);
  const subagentsChange = useChildChange(subagents, SUBAGENTS, onChange, false);
  const presetPath = `${path}.preset`;
  const endpoint = specEndpoint(spec);
  const isAgent = isAgentSpec(spec);
  const promptKey = promptKeyFor(
    endpoint,
    typeof preset.model === 'string' ? preset.model : '',
    options.customEndpoint(endpoint),
  );
  const promptKeys = [
    promptKey,
    'greeting',
    ...(ASSISTANT_ENDPOINTS.has(endpoint) || hasValue(preset.instructions) ? ['instructions'] : []),
    ...(ASSISTANT_ENDPOINTS.has(endpoint) || hasValue(preset.additional_instructions)
      ? ['additional_instructions']
      : []),
  ];
  const errorFields = new Set(
    problemsOf(problems, index)
      .filter((problem) => problem.level === 'error')
      .map((problem) => problem.field),
  );
  const opensFor = (keys: string[]) => keys.some((key) => errorFields.has(key));
  const paths = (keys: string[], base = path) => keys.map((key) => `${base}.${key}`);
  const rest = fields.filter((field) => !GROUPED.has(field.key));

  /** Under "Set values only", a row (or group) without a value is left out. */
  const shows = (record: t.ConfigRecord, key: string) => !configuredOnly || hasValue(record[key]);
  const showsGroup = (count: number) => !configuredOnly || count > 0;
  const modelKeys = ['endpoint', 'model', 'agent_id', 'modelLabel', 'assistant_id'];
  const paramCount = Object.keys(preset).filter(
    (key) => !modelKeys.includes(key) && !promptKeys.includes(key),
  ).length;
  const subagentKeys = (subagentsField?.children ?? []).map((field) => field.key);
  const advancedKeys = [...ADVANCED, ...rest.map((field) => field.key)];

  const row = (key: string) => {
    const field = byKey.get(key);
    if (!field || !shows(spec, key)) return null;
    return renderInlineField(
      field,
      spec,
      path,
      onChange,
      localize,
      disabled,
      undefined,
      true,
      editSessionId,
    );
  };
  const presetRow = (key: string) => {
    const field = presetField?.children?.find((child) => child.key === key);
    if (!field || !shows(preset, key)) return null;
    return renderInlineField(
      field,
      preset,
      presetPath,
      presetChange.change,
      localize,
      disabled,
      undefined,
      false,
      editSessionId,
    );
  };
  const presetChildField = (key: string) =>
    presetField?.children?.find((child) => child.key === key);
  const fieldProps = { spec, index, path, onChange, disabled };
  const presetProps = { ...fieldProps, onPresetChange: presetChange.change };

  return (
    <div className="flex min-w-0 flex-col **:[[role=group]]:flex-wrap">
      {showsGroup(countSet(spec, BASICS)) && (
        <SpecGroup
          title={localize('com_config_specs_group_basics')}
          paths={paths(BASICS)}
          defaultExpanded
        >
          {shows(spec, 'label') && <LabelField {...fieldProps} field={byKey.get('label')} />}
          {shows(spec, 'name') && <NameField {...fieldProps} field={byKey.get('name')} />}
          {row('description')}
          {shows(spec, 'iconURL') && <IconField {...fieldProps} field={byKey.get('iconURL')} />}
        </SpecGroup>
      )}

      <SpecGroup
        title={localize('com_config_specs_group_model')}
        description={localize('com_config_specs_group_model_desc')}
        paths={paths(modelKeys, presetPath)}
        defaultExpanded
      >
        {shows(preset, 'endpoint') && (
          <EndpointField {...presetProps} field={presetChildField('endpoint')} />
        )}
        {isAgent && shows(preset, 'agent_id') && (
          <AgentField {...presetProps} field={presetChildField('agent_id')} />
        )}
        {!isAgent && shows(preset, 'model') && (
          <ModelField {...presetProps} field={presetChildField('model')} />
        )}
        {isAgent && hasValue(preset.model) && presetRow('model')}
        {ASSISTANT_ENDPOINTS.has(endpoint) && presetRow('assistant_id')}
        {presetRow('modelLabel')}
      </SpecGroup>

      {presetField && showsGroup(paramCount) && (
        <SpecGroup
          title={localize('com_config_specs_group_params')}
          description={localize('com_config_specs_group_params_desc')}
          paths={[presetPath]}
          defaultExpanded={false}
        >
          <PresetEditor
            presetField={presetField}
            preset={preset}
            path={presetPath}
            onChange={presetChange.change}
            onReplace={presetChange.replace}
            disabled={disabled}
            editSessionId={editSessionId}
          />
        </SpecGroup>
      )}

      {showsGroup(countSet(preset, promptKeys)) && (
        <SpecGroup
          title={localize('com_config_specs_group_prompt')}
          paths={paths(promptKeys, presetPath)}
          configuredCount={countSet(preset, promptKeys)}
          totalCount={promptKeys.length}
        >
          {promptKeys.map((key) => presetRow(key))}
        </SpecGroup>
      )}

      {showsGroup(countSet(spec, CAPABILITIES)) && (
        <SpecGroup
          title={localize('com_config_specs_group_capabilities')}
          description={localize('com_config_specs_group_capabilities_desc')}
          paths={paths(CAPABILITIES)}
          configuredCount={countSet(spec, CAPABILITIES)}
          totalCount={CAPABILITIES.length}
        >
          {CAPABILITIES.filter((key) => key !== 'mcpServers').map((key) => row(key))}
          {shows(spec, 'mcpServers') && (
            <McpField {...fieldProps} field={byKey.get('mcpServers')} />
          )}
        </SpecGroup>
      )}

      {showsGroup(countSet(spec, MENU)) && (
        <SpecGroup
          title={localize('com_config_specs_group_menu')}
          paths={paths(MENU)}
          configuredCount={countSet(spec, MENU)}
          totalCount={MENU.length}
        >
          {row('showInMenu')}
          {shows(spec, 'group') && <GroupField {...fieldProps} field={byKey.get('group')} />}
          {shows(spec, 'groupIcon') && (
            <IconField {...fieldProps} field={byKey.get('groupIcon')} keyName="groupIcon" />
          )}
          {MENU.slice(3).map((key) => row(key))}
        </SpecGroup>
      )}

      {showsGroup(countSet(spec, DEFAULTS)) && (
        <SpecGroup
          title={localize('com_config_specs_group_defaults')}
          paths={paths(DEFAULTS)}
          defaultExpanded={opensFor(DEFAULTS)}
          configuredCount={countSet(spec, DEFAULTS)}
          totalCount={1}
        >
          <DefaultField spec={spec} index={index} path={path} disabled={disabled} />
        </SpecGroup>
      )}

      {subagentsField && showsGroup(countSet(subagents, subagentKeys)) && (
        <SpecGroup
          title={localize('com_config_specs_group_subagents')}
          description={localize('com_config_specs_group_subagents_desc')}
          paths={[`${path}.${SUBAGENTS}`]}
          configuredCount={countSet(subagents, subagentKeys)}
          totalCount={subagentsField.children?.length ?? 0}
        >
          {(subagentsField.children ?? []).map((field) =>
            !shows(subagents, field.key)
              ? null
              : renderInlineField(
                  field,
                  subagents,
                  `${path}.${SUBAGENTS}`,
                  subagentsChange.change,
                  localize,
                  disabled,
                  undefined,
                  false,
                  editSessionId,
                ),
          )}
        </SpecGroup>
      )}

      {showsGroup(countSet(spec, advancedKeys)) && (
        <SpecGroup
          title={localize('com_config_specs_group_advanced')}
          paths={paths(advancedKeys)}
          configuredCount={countSet(spec, advancedKeys)}
          totalCount={advancedKeys.length}
        >
          {ADVANCED.map((key) => row(key))}
          {rest.map((field) => row(field.key))}
          <UnknownSettings fields={fields} value={spec} path={path} />
          {presetField && (
            <UnknownSettings fields={presetField.children ?? []} value={preset} path={presetPath} />
          )}
        </SpecGroup>
      )}
    </div>
  );
}
