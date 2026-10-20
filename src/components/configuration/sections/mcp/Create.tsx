import { useMemo, useState } from 'react';
import { TextField } from '@clickhouse/click-ui';
import {
  SSEOptionsSchema,
  WebSocketOptionsSchema,
  StreamableHTTPOptionsSchema,
} from 'librechat-data-provider';
import type * as t from '@/types';
import { planTransportSwitch, transportLabelKey, transportOf, TRANSPORTS } from './transport';
import { ConfiguredOnlyContext } from '@/contexts/ConfiguredOnlyContext';
import { ConfigErrorsProvider } from '@/contexts/ConfigErrorsContext';
import { deepClone, isPlainObject, setLeaf } from './validation';
import { cn, isConfigRecord, toConfigIssues } from '@/utils';
import { FormDialog } from '@/components/shared';
import { serverNameProblem } from './names';
import { McpServerEditor } from './Editor';
import { labelForPath } from '../../meta';
import { useLocalize } from '@/hooks';
import { hasValue } from './values';
import { McpNote } from './Note';

/** Data path of the draft: field ids and the tri-states' names derive from it ("New server: Startup"). */
export const DRAFT_PATH = 'mcpDraft';

const NAME_ID = `${DRAFT_PATH}-name`;

const DESCRIPTION_KEYS: Readonly<Record<string, string>> = {
  'streamable-http': 'com_config_mcp_transport_streamable_http_desc',
  sse: 'com_config_mcp_transport_sse_desc',
  websocket: 'com_config_mcp_transport_websocket_desc',
  stdio: 'com_config_mcp_transport_stdio_desc',
};

type ParseableSchema = t.ZodSchemaLike & {
  safeParse: (value: t.ConfigValue) => t.SchemaParseResult;
};

/** The schema a new server of each transport must satisfy (stdio can't be created here). */
function schemaFor(transport: t.McpTransport): ParseableSchema | undefined {
  if (transport === 'sse') return SSEOptionsSchema as ParseableSchema;
  if (transport === 'websocket') return WebSocketOptionsSchema as ParseableSchema;
  if (transport === 'streamable-http' || transport === 'http') {
    return StreamableHTTPOptionsSchema as ParseableSchema;
  }
  return undefined;
}

const NEW_SERVER: t.ConfigRecord = { type: 'streamable-http' };

/** The draft as it would be saved: blank values and empty objects and lists left out. */
function toEntry(value: t.ConfigRecord): t.ConfigRecord {
  const entry: t.ConfigRecord = {};
  for (const [key, child] of Object.entries(value)) {
    const cleaned = isPlainObject(child) ? toEntry(child) : child;
    if (hasValue(cleaned)) entry[key] = cleaned;
  }
  return entry;
}

interface DraftCheck {
  /** Labels of required fields still empty ("URL", "Scopes"). */
  missing: string[];
  /** Inline errors of fields that hold a value. */
  errors: t.PathErrors;
}

/** Validates the draft with its transport's schema: what is missing, and what is wrong where it was typed. */
function checkDraft(entry: t.ConfigRecord, localize: t.LocalizeFn): DraftCheck {
  const result = schemaFor(transportOf(entry))?.safeParse(entry);
  if (!result || result.success || !result.error) return { missing: [], errors: {} };
  const missing: string[] = [];
  const errors: t.PathErrors = {};
  for (const issue of toConfigIssues(result.error.issues, DRAFT_PATH)) {
    const rest = issue.path.slice(DRAFT_PATH.length + 1);
    if (issue.code === 'required' && valueAt(entry, rest) === undefined) {
      missing.push(labelForPath(`mcpServers.{}.${rest}`, localize));
    } else if (!(issue.path in errors)) {
      errors[issue.path] = issue.message;
    }
  }
  return { missing, errors };
}

function valueAt(entry: t.ConfigRecord, path: string): t.ConfigValue {
  let cursor: t.ConfigValue = entry;
  for (const segment of path.split('.')) {
    if (!isConfigRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

/** Transport cards (MCP-9): what each one is for; Streamable HTTP first and recommended, stdio disabled (D10). */
function TransportCards({
  value,
  onChange,
}: {
  value: t.McpTransport;
  onChange: (next: t.McpTransport) => void;
}) {
  const localize = useLocalize();
  const name = `${DRAFT_PATH}-transport`;
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-none p-0">
      <legend className="mb-2 p-0 text-sm font-medium text-(--cui-color-text-default)">
        {localize('com_config_mcp_create_transport')}
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {TRANSPORTS.map((transport) => {
          const isDisabled = transport === 'stdio';
          const isChecked = value === transport;
          const id = `${name}-${transport}`;
          return (
            <label
              key={transport}
              htmlFor={id}
              className={cn(
                'flex min-w-0 gap-2 rounded-md border border-solid px-3 py-2 text-sm',
                isChecked
                  ? 'border-(--cui-color-stroke-intense) bg-(--cui-color-background-muted)'
                  : 'border-(--cui-color-stroke-default)',
                isDisabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={transport}
                checked={isChecked}
                disabled={isDisabled}
                onChange={() => onChange(transport)}
                aria-describedby={`${id}-desc`}
                className="mt-0.5 shrink-0"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-medium text-(--cui-color-text-default)">
                  {localize(transportLabelKey(transport))}
                  {transport === 'streamable-http' && (
                    <span className="state-chip state-chip-default">
                      {localize('com_config_mcp_transport_recommended')}
                    </span>
                  )}
                </span>
                <span id={`${id}-desc`} className="text-xs text-(--cui-color-text-muted)">
                  {localize(DESCRIPTION_KEYS[transport])}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Add an MCP server (MCP-9): a name, the transport as cards (Streamable HTTP
 * by default), then the server's own form with Connection, Authentication
 * and Display open. Fields the transport doesn't read are dropped when it
 * changes, so nothing hidden is created. Create is enabled once the server
 * is valid; until then the footer names what is missing. In a profile, a
 * name Base already defines becomes "Override …" (or "Unhide …" when the
 * profile hides it) instead of a duplicate.
 */
export function CreateMcpServerDialog({
  open,
  onClose,
  onCreate,
  onOverride,
  onUnhide,
  fields,
  existingKeys,
  inheritedKeys,
  hiddenKeys,
}: t.CreateMcpServerDialogProps) {
  const localize = useLocalize();
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<t.ConfigRecord>(NEW_SERVER);
  const trimmed = name.trim();
  const isHidden = hiddenKeys.has(trimmed);
  const isInherited = !isHidden && inheritedKeys.has(trimmed);
  const nameProblem = isHidden || isInherited ? null : serverNameProblem(trimmed, existingKeys);
  const entry = useMemo(() => toEntry(draft), [draft]);
  const check = useMemo(() => checkDraft(entry, localize), [entry, localize]);
  const missing =
    trimmed === '' ? [localize('com_config_server_name'), ...check.missing] : check.missing;
  const shownNameProblem = trimmed === '' ? null : nameProblem;

  const reset = () => {
    setName('');
    setDraft(NEW_SERVER);
  };
  const close = () => {
    reset();
    onClose();
  };

  const change = (leaf: string, value: t.ConfigValue) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      setLeaf(next, leaf.split('.'), value);
      return next;
    });
  };

  const applyPlan = (plan: t.McpSwitchPlan) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      for (const key of plan.prune) delete next[key];
      for (const [key, value] of plan.set) next[key] = value;
      return next;
    });
  };

  const submit = () => {
    if (isInherited) {
      onOverride(trimmed);
      close();
      return;
    }
    if (isHidden) {
      onUnhide(trimmed);
      close();
      return;
    }
    if (nameProblem || missing.length > 0 || Object.keys(check.errors).length > 0) return;
    onCreate(trimmed, entry);
    close();
  };

  const submitLabel = (() => {
    if (isInherited) return localize('com_config_mcp_create_override', { name: trimmed });
    if (isHidden) return localize('com_config_mcp_create_unhide', { name: trimmed });
    return localize('com_ui_create');
  })();
  const blocked =
    !isInherited &&
    !isHidden &&
    (nameProblem != null || missing.length > 0 || Object.keys(check.errors).length > 0);

  return (
    <FormDialog
      open={open}
      title={localize('com_config_create_mcp_server')}
      submitLabel={submitLabel}
      submitDisabled={blocked}
      saving={false}
      error={shownNameProblem ? localize(shownNameProblem) : undefined}
      hint={
        !isInherited && !isHidden && missing.length > 0
          ? localize('com_config_mcp_create_missing', { fields: missing.join(', ') })
          : undefined
      }
      size="lg"
      onSubmit={submit}
      onClose={close}
    >
      <ConfiguredOnlyContext.Provider value={false}>
        <ConfigErrorsProvider value={check.errors}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={NAME_ID}
                className="text-sm font-medium text-(--cui-color-text-default)"
              >
                {localize('com_config_server_name')}
                <span aria-hidden="true" className="ml-0.5 text-(--cui-color-text-danger)">
                  *
                </span>
              </label>
              <TextField
                id={NAME_ID}
                value={name}
                onChange={setName}
                placeholder={localize('com_config_mcp_create_name_placeholder')}
                aria-describedby={`${NAME_ID}-hint`}
                aria-invalid={shownNameProblem ? true : undefined}
                autoFocus
              />
              <span id={`${NAME_ID}-hint`} className="text-xs text-(--cui-color-text-muted)">
                {localize('com_config_mcp_name_hint')}
              </span>
            </div>
            {isInherited && (
              <McpNote tone="warning">
                {localize('com_config_mcp_create_inherited', { name: trimmed })}
              </McpNote>
            )}
            {isHidden && (
              <McpNote tone="warning">
                {localize('com_config_mcp_create_hidden', { name: trimmed })}
              </McpNote>
            )}
            {!isInherited && !isHidden && (
              <>
                <TransportCards
                  value={transportOf(draft)}
                  onChange={(next) => applyPlan(planTransportSwitch(draft, next, undefined))}
                />
                <McpServerEditor
                  fields={fields}
                  entryPath={DRAFT_PATH}
                  entry={draft}
                  lower={undefined}
                  onChange={change}
                  onSwitch={applyPlan}
                  typeLocked
                  hideType
                  isDraft
                  quiet
                />
              </>
            )}
          </div>
        </ConfigErrorsProvider>
      </ConfiguredOnlyContext.Provider>
    </FormDialog>
  );
}
