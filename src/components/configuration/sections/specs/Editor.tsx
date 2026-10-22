import { useMemo, useRef, useCallback } from 'react';
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
} from './Fields';
import { isAgentSpec, problemsOf, specEndpoint, ASSISTANT_ENDPOINTS } from './validation';
import { isConfigRecord, hasConfigValue } from '@/utils';
import { UnknownSettings } from '../../UnknownSettings';
import { useSpecList, specIndexOf } from './context';
import { renderInlineField } from '../../renderer';
import { PresetEditor } from './PresetEditor';
import { presetParams, specPromptKeys } from './params';
import { useLocalize } from '@/hooks';
import { SpecGroup } from './Group';

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

function countSet(record: t.ConfigRecord, keys: readonly string[]): number {
  return keys.filter((key) => hasConfigValue(record[key])).length;
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
  const promptKeys = specPromptKeys(preset, endpoint, options.customEndpoint(endpoint));
  const errorFields = new Set(
    problemsOf(problems, index)
      .filter((problem) => problem.level === 'error')
      .map((problem) => problem.field),
  );
  const opensFor = (keys: string[]) => keys.some((key) => errorFields.has(key));
  const paths = (keys: string[], base = path) => keys.map((key) => `${base}.${key}`);
  const rest = fields.filter((field) => !GROUPED.has(field.key));

  /**
   * Under "Set values only", a row (or group) without a value is left out,
   * unless it needs one: a required field still empty (a new spec's Label,
   * Name, Endpoint and Model) stays, so the spec can be completed.
   */
  const shows = (record: t.ConfigRecord, key: string, problemField = key) =>
    !configuredOnly || hasConfigValue(record[key]) || errorFields.has(problemField);
  const showsPreset = (key: string) => shows(preset, key, `preset.${key}`);
  const showsGroup = (count: number) => !configuredOnly || count > 0;
  const modelKeys = ['endpoint', 'model', 'agent_id', 'modelLabel', 'assistant_id'];
  const setParams = Object.keys(preset).filter(
    (key) => !modelKeys.includes(key) && !promptKeys.includes(key),
  );
  const presetKeys = useMemo(
    () => new Set((presetField?.children ?? []).map((field) => field.key)),
    [presetField],
  );
  /** The endpoint's own parameters, plus the other preset fields the spec sets (all listed in the group). */
  const offered = new Set(
    presetParams(
      endpoint,
      typeof preset.model === 'string' ? preset.model : '',
      options.customEndpoint(endpoint),
      presetKeys,
    ).params.map((param) => param.key),
  );
  const paramCount = setParams.length;
  const paramTotal = offered.size + setParams.filter((key) => !offered.has(key)).length;
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
    if (!field || !showsPreset(key)) return null;
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

  const basicsGroup =
    showsGroup(countSet(spec, BASICS)) || opensFor(BASICS) ? (
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
    ) : null;
  const modelGroup = (
    <SpecGroup
      title={localize('com_config_specs_group_model')}
      description={localize('com_config_specs_group_model_desc')}
      paths={paths(modelKeys, presetPath)}
      defaultExpanded
    >
      {showsPreset('endpoint') && (
        <EndpointField {...presetProps} field={presetChildField('endpoint')} />
      )}
      {isAgent && showsPreset('agent_id') && (
        <AgentField {...presetProps} field={presetChildField('agent_id')} />
      )}
      {!isAgent && showsPreset('model') && (
        <ModelField {...presetProps} field={presetChildField('model')} />
      )}
      {isAgent && hasConfigValue(preset.model) && presetRow('model')}
      {!isAgent && hasConfigValue(preset.agent_id) && presetRow('agent_id')}
      {(ASSISTANT_ENDPOINTS.has(endpoint) || hasConfigValue(preset.assistant_id)) &&
        presetRow('assistant_id')}
      {presetRow('modelLabel')}
    </SpecGroup>
  );

  return (
    <div className="spec-editor flex min-w-0 flex-col **:[[role=group]]:flex-wrap">
      {basicsGroup}
      {modelGroup}

      {presetField && showsGroup(paramCount) && (
        <SpecGroup
          title={localize('com_config_specs_group_params')}
          description={localize('com_config_specs_group_params_desc')}
          paths={[presetPath]}
          defaultExpanded={false}
          configuredCount={paramCount}
          totalCount={paramTotal}
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
          <UnknownSettings
            fields={subagentsField.children ?? []}
            value={subagents}
            path={`${path}.${SUBAGENTS}`}
          />
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
