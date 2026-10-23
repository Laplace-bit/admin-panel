import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  PROCESS_FIELDS,
  INSPECTOR_DERIVED,
  transportOf,
  isMcpFieldShown,
  isHttpTransport,
  transportLabelKey,
} from './transport';
import { renderCollectionEntryFields, toFieldId } from '../../renderer';
import { RecordObjectField } from '../../fields/RecordObjectField';
import { isConfigRecord, isConfigValueEqual } from '@/utils';
import { useLocalize } from '@/hooks';
import { TransportSelect } from './Transport';
import { InstructionsField } from './Instructions';
import { asRecord, hasValue } from './values';
import { McpAuthMethod } from './Method';
import { McpFieldGroup } from './Group';
import { IconPreview } from './Icon';
import { McpField } from './Field';

const CONNECTION = ['type', 'url', 'headers', ...PROCESS_FIELDS];
/** Process fields every stdio server has; the optional ones are listed only when set. */
const REQUIRED_PROCESS_FIELDS: ReadonlySet<string> = new Set(['command', 'args']);
const DISPLAY = ['title', 'description', 'iconPath', 'chatMenu'];
const BEHAVIOR = ['startup', 'serverInstructions', 'timeout', 'initTimeout'];
const USER_VARIABLES = ['customUserVars'];
const ADVANCED = [
  'requestHeaders',
  'proxy',
  'sseReadTimeout',
  'oauthRefreshWaitTimeout',
  'oauthRefreshCoordination',
  'oauthPersistenceWaitTimeout',
];
const AUTH_KEYS = ['requiresOAuth', 'apiKey', 'oauth', 'oauth_headers', 'obo'];

const GROUPED: ReadonlySet<string> = new Set([
  ...CONNECTION,
  ...DISPLAY,
  ...BEHAVIOR,
  ...USER_VARIABLES,
  ...ADVANCED,
  ...AUTH_KEYS,
]);

/**
 * The purpose-built editor of one MCP server (MCP-1…MCP-8): Connection (the
 * transport and its fields only), Authentication (one method), Display,
 * Behavior, User variables and Advanced. Fields the transport doesn't read
 * are not shown; a stdio server's process fields are read-only (D10); a
 * server librechat.yaml (or Base) defines keeps its transport.
 */
export function McpServerEditor({
  fields,
  entryPath,
  entry,
  lower,
  onChange,
  onSwitch,
  onDiscard,
  disabled,
  typeLocked,
  hideType,
  isDraft,
  quiet,
  owned,
  ownKeys,
  editSessionId,
}: t.McpEditorProps) {
  const localize = useLocalize();
  const transport = transportOf(entry);
  /** An entry that says nothing about its transport is edited as Streamable HTTP, so its URL can be set. */
  const gating = transport || 'streamable-http';
  const isHttp = isHttpTransport(gating);
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const isShown = (key: string) => fieldsByKey.has(key) && isMcpFieldShown(key, gating);
  const shownKeys = (keys: readonly string[]) => keys.filter(isShown);
  const pathsOf = (keys: readonly string[]) => keys.map((key) => `${entryPath}.${key}`);
  const countSet = (keys: readonly string[]) => keys.filter((key) => hasValue(entry[key])).length;
  /** Whether "Set values only" keeps a group: a value at all in Base, the profile's own in a profile. */
  const keeps = (keys: readonly string[]) =>
    keys.some((key) => (ownKeys ? ownKeys.has(key) : hasValue(entry[key])));
  const yamlLock = localize('com_config_mcp_locked_yaml');

  const renderField = (key: string, options?: Partial<t.McpFieldRowProps>): ReactNode => {
    const field = fieldsByKey.get(key);
    if (!field || !isShown(key)) return null;
    return (
      <McpField
        key={key}
        field={field}
        entryPath={entryPath}
        entry={entry}
        onChange={onChange}
        onDiscard={onDiscard}
        disabled={disabled}
        quiet={quiet}
        owned={owned}
        {...options}
      />
    );
  };

  const renderNested = (
    parent: string,
    key: string,
    options?: Partial<t.McpFieldRowProps>,
  ): ReactNode => {
    const field = fieldsByKey.get(parent)?.children?.find((child) => child.key === key);
    if (!field) return null;
    return (
      <McpField
        key={`${parent}.${key}`}
        field={field}
        entryPath={`${entryPath}.${parent}`}
        entry={asRecord(entry[parent])}
        onChange={(childKey, value) => onChange(`${parent}.${childKey}`, value)}
        onDiscard={onDiscard}
        disabled={disabled}
        quiet={quiet}
        owned={owned}
        {...options}
      />
    );
  };

  const typeId = toFieldId(`${entryPath}.type`);
  const typeLabel = localize('com_config_field_type');
  const typeControl =
    typeLocked || disabled ? (
      <span id={typeId} className="static-value">
        {localize(transportLabelKey(transport))}
      </span>
    ) : (
      <TransportSelect
        key={editSessionId}
        id={typeId}
        label={typeLabel}
        entry={entry}
        lower={lower}
        transport={transport}
        confirmPrune={!isDraft}
        onSwitch={onSwitch}
      />
    );

  const advanced = [
    ...shownKeys(ADVANCED),
    ...fields
      .map((field) => field.key)
      .filter((key) => !GROUPED.has(key) && !INSPECTOR_DERIVED.has(key) && isShown(key)),
  ];
  const authPaths = pathsOf(AUTH_KEYS.filter((key) => fieldsByKey.has(key)));

  return (
    <div className="flex flex-col gap-1">
      <McpFieldGroup
        title={localize('com_config_mcp_group_connection')}
        paths={pathsOf(shownKeys(CONNECTION))}
        defaultExpanded
        hasValues={keeps(shownKeys(CONNECTION))}
      >
        {!hideType &&
          renderField('type', {
            control: typeControl,
            lockReason: typeLocked && !disabled ? yamlLock : undefined,
            required: !typeLocked,
          })}
        {renderField('url', {
          required: true,
          extra: <UrlHint transport={transport} />,
        })}
        {renderField('headers')}
        {[...PROCESS_FIELDS]
          .filter((key) => REQUIRED_PROCESS_FIELDS.has(key) || hasValue(entry[key]))
          .map((key) => renderField(key, { lockReason: yamlLock }))}
      </McpFieldGroup>
      {(isHttp || AUTH_KEYS.some((key) => hasValue(entry[key]))) && (
        <McpFieldGroup
          title={localize('com_config_mcp_group_auth')}
          paths={authPaths}
          defaultExpanded={isDraft === true}
          configured={
            hasValue(entry.apiKey) || hasValue(entry.oauth) || hasValue(entry.obo) ? 1 : 0
          }
        >
          <McpAuthMethod
            key={editSessionId}
            id={toFieldId(`${entryPath}.authMethod`)}
            entryPath={entryPath}
            entry={entry}
            lower={lower}
            disabled={disabled}
            onSwitch={onSwitch}
            renderField={renderField}
            renderNested={renderNested}
          />
        </McpFieldGroup>
      )}
      <McpFieldGroup
        title={localize('com_config_mcp_group_display')}
        paths={pathsOf(shownKeys(DISPLAY))}
        defaultExpanded={isDraft === true}
        configured={countSet(DISPLAY)}
        total={shownKeys(DISPLAY).length}
        hasValues={keeps(DISPLAY)}
      >
        {renderField('title', {
          extra: <span className="settings-hint">{localize('com_config_mcp_title_hint')}</span>,
        })}
        {renderField('description')}
        {renderField('iconPath', {
          extra: <IconPreview src={entry.iconPath} />,
        })}
        {renderField('chatMenu')}
      </McpFieldGroup>
      <McpFieldGroup
        title={localize('com_config_mcp_group_behavior')}
        paths={pathsOf(shownKeys(BEHAVIOR))}
        defaultExpanded={false}
        configured={countSet(BEHAVIOR)}
        total={shownKeys(BEHAVIOR).length}
        hasValues={keeps(BEHAVIOR)}
      >
        {renderField('startup')}
        <InstructionsRow
          renderField={renderField}
          entryPath={entryPath}
          entry={entry}
          onChange={onChange}
          disabled={disabled}
        />
        {renderField('timeout')}
        {renderField('initTimeout')}
      </McpFieldGroup>
      {isShown('customUserVars') && (
        <McpFieldGroup
          title={localize('com_config_mcp_group_user_vars')}
          description={localize('com_config_desc_mcpServers_customUserVars')}
          paths={pathsOf(USER_VARIABLES)}
          defaultExpanded={false}
          hasValues={keeps(USER_VARIABLES)}
        >
          <UserVariables
            field={fieldsByKey.get('customUserVars')!}
            entryPath={entryPath}
            value={entry.customUserVars}
            lower={lower?.customUserVars}
            onChange={onChange}
            disabled={disabled}
            editSessionId={editSessionId}
          />
        </McpFieldGroup>
      )}
      {advanced.length > 0 && (
        <McpFieldGroup
          title={localize('com_config_mcp_group_advanced')}
          paths={pathsOf(advanced)}
          defaultExpanded={false}
          configured={countSet(advanced)}
          total={advanced.length}
          hasValues={keeps(advanced)}
        >
          {advanced.map((key) => renderField(key))}
        </McpFieldGroup>
      )}
    </div>
  );
}

/** `serverInstructions`: Off / Server-provided / Custom text, through the shared row. */
function InstructionsRow({
  renderField,
  entryPath,
  entry,
  onChange,
  disabled,
}: {
  renderField: (key: string, options?: Partial<t.McpFieldRowProps>) => ReactNode;
  entryPath: string;
  entry: t.ConfigRecord;
  onChange: (key: string, value: t.ConfigValue) => void;
  disabled?: boolean;
}) {
  return renderField('serverInstructions', {
    renderControl: disabled
      ? ({ id, fieldDefault }) => (
          <span id={id} className="static-value">
            <InstructionsText value={entry.serverInstructions ?? fieldDefault.value} />
          </span>
        )
      : ({ id, label, fieldDefault, clear }) => (
          <InstructionsField
            id={id}
            value={entry.serverInstructions}
            fieldDefault={fieldDefault}
            onChange={(value) => onChange('serverInstructions', value)}
            onClear={clear}
            aria-label={label}
          />
        ),
    entryPath,
  });
}

/** Server instructions as read-only text: Off, Server-provided, or the custom text. */
function InstructionsText({ value }: { value: t.ConfigValue }) {
  const localize = useLocalize();
  if (typeof value === 'string' && value !== '') return <>{value}</>;
  return (
    <>{localize(value === true ? 'com_config_mcp_instructions_server' : 'com_config_ctl_off')}</>
  );
}

/** What a transport's URL looks like. */
function UrlHint({ transport }: { transport: t.McpTransport }) {
  const localize = useLocalize();
  const key =
    transport === 'websocket' ? 'com_config_mcp_url_hint_websocket' : 'com_config_mcp_url_hint';
  return <span className="settings-hint">{localize(key)}</span>;
}

/**
 * The values each user enters (customUserVars), as cards keyed by variable
 * name. Only the variables that change are written, so a server's override
 * stays sparse; variables the layer beneath defines can't be removed (D3).
 */
function UserVariables({
  field,
  entryPath,
  value,
  lower,
  onChange,
  disabled,
  editSessionId,
}: {
  field: t.SchemaField;
  entryPath: string;
  value: t.ConfigValue;
  lower: t.ConfigValue;
  onChange: (leaf: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  editSessionId?: number;
}) {
  const current = asRecord(value);
  const write = (next: t.ConfigValue) => {
    const nextRecord = asRecord(next);
    for (const [key, item] of Object.entries(nextRecord)) {
      if (!isConfigValueEqual(current[key], item)) onChange(`${field.key}.${key}`, item);
    }
    for (const key of Object.keys(current)) {
      if (!Object.hasOwn(nextRecord, key)) onChange(`${field.key}.${key}`, undefined);
    }
  };
  return (
    <div className="py-2">
      <RecordObjectField
        id={toFieldId(`${entryPath}.${field.key}`)}
        path={`${entryPath}.${field.key}`}
        value={value}
        fields={field.children ?? []}
        onChange={write}
        disabled={disabled}
        renderFields={renderCollectionEntryFields}
        editSessionId={editSessionId}
        lockedKeys={isConfigRecord(lower) ? new Set(Object.keys(lower)) : undefined}
      />
    </div>
  );
}
