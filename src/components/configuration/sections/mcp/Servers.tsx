import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@clickhouse/click-ui';
import { isProcessMCPServerConfig } from 'librechat-data-provider';
import type * as t from '@/types';
import { ConfiguredOnlyContext } from '@/contexts/ConfiguredOnlyContext';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { getValueAtPath, isConfigRecord, isRowVisible } from '@/utils';
import { McpDeletedRow, McpHiddenRow, McpServerCard } from './Card';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { INSPECTOR_DERIVED, transportOf } from './transport';
import { previewedSecret, storedSecrets } from './validation';
import { copyName, serverNameProblem } from './names';
import { DecorativeIcon } from '@/components/shared';
import { buildServerList, leafEntries } from './list';
import { useLocalize, useValuesScope } from '@/hooks';
import { CreateMcpServerDialog } from './Create';
import { sourceLabel } from '../../values';
import { McpServerEditor } from './Editor';
import { labelForPath } from '../../meta';
import { asRecord } from './values';
import { McpNote } from './Note';

const EMPTY_RECORD: t.ConfigRecord = Object.freeze({}) as t.ConfigRecord;
const EMPTY_KEYS: ReadonlySet<string> = new Set();

/** A server's source badge, by edit target and whether the layer beneath defines it. */
const SOURCES: Readonly<
  Record<'base' | 'scope', Readonly<Record<'lower' | 'own', t.McpServerSource>>>
> = {
  base: { lower: 'yaml', own: 'admin' },
  scope: { lower: 'inherited', own: 'scope' },
};

/** Why a server's fields can't be edited here. */
type ReadOnlyReason = 'dotted' | 'process' | 'inherited';

type Row =
  | { kind: 'server'; key: string; value: t.ConfigRecord }
  | { kind: 'deleted'; key: string }
  | { kind: 'hidden'; key: string; pending: boolean };

/**
 * Leaves worth copying into a new server: values, not empty objects,
 * inspector data, or the masked preview the admin API returns for a stored
 * secret (the secret itself is never sent to the panel, so it can't be copied).
 */
function copyableLeaves(value: t.ConfigRecord): Array<[string[], t.ConfigValue]> {
  return leafEntries(value).filter(
    ([segments, leaf]) =>
      !INSPECTOR_DERIVED.has(segments[0]) &&
      leaf !== undefined &&
      leaf !== null &&
      !(isConfigRecord(leaf) && Object.keys(leaf).length === 0) &&
      previewedSecret(segments) == null,
  );
}

function countLeaves(value: t.ConfigValue): number {
  return isConfigRecord(value) ? leafEntries(value).length : 0;
}

/** Keys of the servers a set of tombstone paths hides (`mcpServers.github` → `github`). */
function hiddenServerKeys(paths: Iterable<string>, prefix: string): string[] {
  const keys: string[] = [];
  for (const tombstone of paths) {
    if (!tombstone.startsWith(prefix)) continue;
    const key = tombstone.slice(prefix.length);
    if (key !== '' && !key.includes('.')) keys.push(key);
  }
  return keys;
}

/**
 * The MCP servers editor (WS12): one card per server with a purpose-built
 * form, its provenance and an actions menu (Rename, Duplicate, Delete, and in
 * a profile Override fields, Hide, Remove overrides). Deletions stay listed
 * with Undo until Save (D9); servers librechat.yaml (or, in a profile, Base)
 * defines can be overridden but not renamed or deleted (D1); stdio servers
 * are defined only in librechat.yaml (D10). Field edits are written per leaf,
 * so a profile override stays sparse.
 */
export function McpServersRenderer({
  fields,
  parentPath: path,
  parentValue,
  getValue,
  onChange,
  onDiscardField,
  onHideField,
  onUnhideField,
  onRenameEntry,
  disabled,
  editedValues,
  yamlBaseKeys,
  isEditingScope,
  showConfiguredOnly,
  editSessionId,
}: t.FieldRendererProps) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const rowFilter = useContext(RowFilterContext);
  const valuesData = useContext(ConfigValuesContext);
  const layers = valuesData?.layers ?? null;
  const inScope = Boolean(isEditingScope) && layers?.scope != null;
  const prefix = `${path}.`;
  const edits = editedValues ?? EMPTY_RECORD;
  /** The saved servers: the page's values already show pending edits, which the list applies itself. */
  const saved = asRecord(
    layers ? getValueAtPath(layers.effective, path) : getValue(path, parentValue ?? EMPTY_RECORD),
  );
  const lower = useMemo(
    () => asRecord(getValueAtPath(inScope ? layers?.base : layers?.yamlEffective, path)),
    [inScope, layers, path],
  );
  const stored = useMemo(
    () =>
      asRecord(getValueAtPath(inScope ? layers?.scope?.overrides : layers?.baseOverrides, path)),
    [inScope, layers, path],
  );
  const lowerKeys = useMemo<ReadonlySet<string>>(
    () => (inScope ? new Set(Object.keys(lower)) : (yamlBaseKeys ?? EMPTY_KEYS)),
    [inScope, lower, yamlBaseKeys],
  );
  const yamlKeys = yamlBaseKeys ?? EMPTY_KEYS;
  const list = useMemo(
    () => buildServerList({ saved, lower, editedValues: edits, path }),
    [saved, lower, edits, path],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renamedFrom, setRenamedFrom] = useState<Readonly<Record<string, string>>>({});
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  const [lastDeleted, setLastDeleted] = useState<string | null>(null);
  /** Duplicates and renamed servers whose source stored secrets the copy left out: they must be entered again. */
  const [reenter, setReenter] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const stash = useRef(new Map<string, Array<[string, t.ConfigValue]>>());
  /** A deleted server's pending rename (original → new name), restored with Undo. */
  const renameStash = useRef(new Map<string, string>());

  /** Keyboard focus follows a server whose control went away (a rename, an undone delete, a new server). */
  useEffect(() => {
    if (focusKey == null) return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-mcp-server="${CSS.escape(focusKey)}"] button[aria-expanded]`,
        )
        ?.focus({ preventScroll: true });
      setFocusKey(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey]);

  useEffect(() => {
    setRenaming(null);
    setRenamedFrom({});
    setUnlocked(EMPTY_KEYS);
    setJustAdded(null);
    setReenter({});
  }, [editSessionId]);

  const discard = (editPath: string) => {
    if (onDiscardField) onDiscardField(editPath);
    else onChange(editPath, undefined);
  };
  const pendingUnder = (fullPath: string) =>
    Object.keys(edits).filter((p) => p === fullPath || p.startsWith(`${fullPath}.`));

  const pendingByServer = useMemo(() => {
    const keys = new Set<string>();
    for (const editPath of Object.keys(edits)) {
      if (!editPath.startsWith(prefix)) continue;
      keys.add(editPath.slice(prefix.length).split('.')[0]);
    }
    return keys;
  }, [edits, prefix]);

  const visibility = valuesData?.visibilityEdits ?? EMPTY_RECORD;
  /** Servers the profile hides (true while the hide is unsaved), and hidden ones it is about to show again. */
  const { hidden, unhiding } = useMemo(() => {
    const hiddenKeys = new Map<string, boolean>();
    const unhidingKeys = new Set<string>();
    if (!inScope) return { hidden: hiddenKeys, unhiding: unhidingKeys };
    for (const key of hiddenServerKeys(layers?.scope?.tombstones ?? [], prefix)) {
      if (visibility[`${prefix}${key}`] === 'unhide') unhidingKeys.add(key);
      else hiddenKeys.set(key, false);
    }
    for (const [visibilityPath, edit] of Object.entries(visibility)) {
      if (edit !== 'hide') continue;
      for (const key of hiddenServerKeys([visibilityPath], prefix)) hiddenKeys.set(key, true);
    }
    return { hidden: hiddenKeys, unhiding: unhidingKeys };
  }, [inScope, layers, prefix, visibility]);

  const allKeys = useMemo(
    () => new Set([...Object.keys(list.record), ...hidden.keys()]),
    [list.record, hidden],
  );

  const writeLeaves = (key: string, value: t.ConfigRecord) => {
    for (const [segments, leaf] of copyableLeaves(value)) {
      onChange(`${prefix}${key}.${segments.join('.')}`, leaf);
    }
  };

  /** Removes one key of a server: its pending edits go, and a saved value is reset. */
  const removeLeafKey = (key: string, leaf: string) => {
    const fullPath = `${prefix}${key}.${leaf}`;
    pendingUnder(fullPath).forEach(discard);
    if (getValueAtPath(saved[key], leaf) !== undefined) onChange(fullPath, undefined);
  };

  const applyPlan = (key: string, plan: t.McpSwitchPlan) => {
    plan.prune.forEach((leaf) => removeLeafKey(key, leaf));
    for (const [leaf, value] of plan.set) {
      if (isConfigRecord(value)) {
        for (const [segments, child] of leafEntries(value)) {
          onChange(`${prefix}${key}.${leaf}.${segments.join('.')}`, child);
        }
      } else {
        onChange(`${prefix}${key}.${leaf}`, value);
      }
    }
  };

  /** Drops a server's pending edits and, for a saved one, stages its removal (D9). */
  const removeServer = (key: string, keepForUndo: boolean) => {
    const entryPath = `${prefix}${key}`;
    const pending = pendingUnder(entryPath);
    if (keepForUndo)
      stash.current.set(
        key,
        pending.map((p) => [p, edits[p]]),
      );
    pending.forEach(discard);
    if (Object.hasOwn(saved, key)) onChange(entryPath, undefined);
  };

  /**
   * Deletes a server (D9). A saved one stays listed with Undo. A server
   * renamed in this session is deleted under its saved name, so the saved
   * server's row (and its Undo, which brings the rename back) shows.
   */
  const handleDelete = (key: string) => {
    if (key.includes('.')) return;
    const original = renamedFrom[key];
    if (original !== undefined) {
      const entryPath = `${prefix}${original}`;
      stash.current.set(original, [
        [entryPath, undefined],
        ...pendingUnder(`${prefix}${key}`).map((p): [string, t.ConfigValue] => [p, edits[p]]),
      ]);
      renameStash.current.set(original, key);
      pendingUnder(`${prefix}${key}`).forEach(discard);
      onRenameEntry?.(`${prefix}${key}`, null);
      setRenamedFrom(({ [key]: _renamed, ...rest }) => rest);
      setLastDeleted(original);
      return;
    }
    removeServer(key, true);
    setLastDeleted(key);
  };

  const handleUndoDelete = (key: string) => {
    pendingUnder(`${prefix}${key}`).forEach(discard);
    for (const [editPath, value] of stash.current.get(key) ?? []) onChange(editPath, value);
    stash.current.delete(key);
    const renamed = renameStash.current.get(key);
    renameStash.current.delete(key);
    if (renamed !== undefined) {
      onRenameEntry?.(`${prefix}${key}`, `${prefix}${renamed}`);
      setRenamedFrom((prev) => ({ ...prev, [renamed]: key }));
    }
    setLastDeleted(null);
    setFocusKey(renamed ?? key);
  };

  const handleRevertAll = (key: string) => {
    pendingUnder(`${prefix}${key}`).forEach(discard);
    onChange(`${prefix}${key}`, undefined);
  };

  const handleRename = (key: string, next: string): string | null => {
    const others = [...allKeys].filter((name) => name !== key);
    const problem = serverNameProblem(next, others);
    if (problem) return localize(problem);
    const value = asRecord(list.record[key]);
    /** The saved server this one is (a rename of): its stored secrets stay behind with its name. */
    const original = renamedFrom[key] ?? (Object.hasOwn(saved, key) ? key : undefined);
    const secrets = [...new Set([...(reenter[key] ?? []), ...storedSecrets(value)])];
    removeServer(key, false);
    writeLeaves(next, value);
    onRenameEntry?.(`${prefix}${key}`, `${prefix}${next}`);
    setReenter(({ [key]: _moved, ...rest }) =>
      secrets.length > 0 ? { ...rest, [next]: secrets } : rest,
    );
    if (original !== undefined) {
      setRenamedFrom(({ [key]: _renamed, ...rest }) => ({ ...rest, [next]: original }));
    }
    setRenaming(null);
    setJustAdded(next);
    setFocusKey(next);
    return null;
  };

  const handleDuplicate = (key: string) => {
    const value = asRecord(list.record[key]);
    const name = copyName(key, allKeys);
    const title = typeof value.title === 'string' ? `${value.title} copy` : undefined;
    writeLeaves(name, title ? { ...value, title } : value);
    const secrets = storedSecrets(value);
    if (secrets.length > 0) setReenter((prev) => ({ ...prev, [name]: secrets }));
    setJustAdded(name);
    setFocusKey(name);
  };

  /** The secrets a duplicate still needs entered (none once each one has a value). */
  const missingSecretsOf = (key: string, value: t.ConfigRecord): string[] =>
    (reenter[key] ?? []).filter((secret) => {
      const current = getValueAtPath(value, secret);
      return typeof current !== 'string' || current === '';
    });

  const handleCreate = (name: string, entry: t.ConfigRecord) => {
    writeLeaves(name, entry);
    setJustAdded(name);
    setFocusKey(name);
  };

  const handleOverride = (key: string) => {
    setUnlocked((prev) => new Set(prev).add(key));
    setJustAdded(key);
    setFocusKey(key);
  };

  const scopeName = sourceLabel('scope', localize, scope);
  const renamedAway = useMemo(() => new Set(Object.values(renamedFrom)), [renamedFrom]);

  const actionsFor = (key: string, value: t.ConfigRecord, overrides: number) => {
    const actions: t.McpServerAction[] = [];
    if (disabled || key.includes('.')) return actions;
    const isLower = lowerKeys.has(key);
    const isYaml = yamlKeys.has(key);
    const ownerReason = localize(
      inScope ? 'com_config_mcp_defined_in_base' : 'com_config_mcp_locked_yaml',
    );
    const isStdio = transportOf(value) === 'stdio';
    const isInheritedLocked =
      inScope && isLower && overrides === 0 && !unlocked.has(key) && !pendingByServer.has(key);
    if (isInheritedLocked && !isStdio) {
      actions.push({
        id: 'override',
        label: localize('com_config_mcp_override_fields', { scope: scopeName }),
        onSelect: () => handleOverride(key),
      });
    }
    actions.push({
      id: 'rename',
      label: localize('com_config_mcp_action_rename'),
      onSelect: () => setRenaming(key),
      disabled: isLower,
      reason: isLower ? ownerReason : undefined,
    });
    actions.push({
      id: 'duplicate',
      label: localize('com_config_mcp_action_duplicate'),
      onSelect: () => handleDuplicate(key),
      disabled: isStdio,
      reason: isStdio ? localize('com_config_mcp_transport_stdio_desc') : undefined,
    });
    if (isLower && overrides > 0) {
      actions.push({
        id: 'revert',
        label: localize(
          inScope ? 'com_config_mcp_action_revert_scope' : 'com_config_mcp_action_revert_yaml',
          { scope: scopeName },
        ),
        onSelect: () => handleRevertAll(key),
        disabled: list.reverted.has(key),
      });
    }
    if (inScope && isLower) {
      actions.push({
        id: 'hide',
        label: localize('com_config_mcp_action_hide', { scope: scopeName }),
        onSelect: () => onHideField?.(`${prefix}${key}`),
        disabled: isYaml || !onHideField,
        reason: isYaml ? localize('com_config_mcp_hide_yaml_unsupported') : undefined,
      });
    }
    actions.push({
      id: 'delete',
      label: localize('com_config_mcp_action_delete'),
      onSelect: () => handleDelete(key),
      disabled: isLower,
      reason: isLower ? ownerReason : undefined,
      danger: true,
    });
    return actions;
  };

  const badgesFor = (key: string): t.McpServerBadges => {
    const isLower = lowerKeys.has(key);
    return {
      source: SOURCES[inScope ? 'scope' : 'base'][isLower ? 'lower' : 'own'],
      overrides: isLower && !list.reverted.has(key) ? countLeaves(stored[key]) : 0,
      edited: pendingByServer.has(key) || unhiding.has(key),
      isNew: !Object.hasOwn(saved, key) && !lowerKeys.has(key),
    };
  };

  const isInheritedReadOnly = (key: string, overrides: number) =>
    inScope &&
    lowerKeys.has(key) &&
    overrides === 0 &&
    !unlocked.has(key) &&
    !pendingByServer.has(key) &&
    !unhiding.has(key);

  const rows = useMemo((): Row[] => {
    const isShown = (key: string) => !rowFilter || isRowVisible(rowFilter, `${prefix}${key}`);
    const result: Row[] = [];
    const deletedAt = new Map(list.deleted.map((ghost) => [ghost.index, ghost.key]));
    Object.keys(saved).forEach((key, index) => {
      const ghost = deletedAt.get(index);
      if (ghost !== undefined && !renamedAway.has(ghost) && !rowFilter) {
        result.push({ kind: 'deleted', key: ghost });
      }
      const value = list.record[key];
      if (value === undefined || hidden.has(key) || !isShown(key)) return;
      result.push({ kind: 'server', key, value: asRecord(value) });
    });
    for (const [key, value] of Object.entries(list.record)) {
      if (Object.hasOwn(saved, key) || hidden.has(key) || !isShown(key)) continue;
      result.push({ kind: 'server', key, value: asRecord(value) });
    }
    for (const key of unhiding) {
      if (!Object.hasOwn(list.record, key) && isShown(key)) {
        result.push({ kind: 'server', key, value: asRecord(lower[key]) });
      }
    }
    if (rowFilter) {
      for (const ghost of list.deleted) {
        if (!renamedAway.has(ghost.key)) result.push({ kind: 'deleted', key: ghost.key });
      }
    }
    for (const [key, pending] of hidden) {
      if (isShown(key)) result.push({ kind: 'hidden', key, pending });
    }
    return result;
  }, [saved, list, hidden, unhiding, lower, rowFilter, prefix, renamedAway]);

  const visibleRows =
    showConfiguredOnly && inScope
      ? rows.filter(
          (row) =>
            row.kind !== 'server' ||
            !lowerKeys.has(row.key) ||
            pendingByServer.has(row.key) ||
            countLeaves(stored[row.key]) > 0,
        )
      : rows;

  const isEmpty = visibleRows.length === 0;

  /** The server keys the open profile stores or edits (top-level keys of its override and edits). */
  const ownKeysOf = (key: string): ReadonlySet<string> => {
    const keys = new Set(Object.keys(asRecord(stored[key])));
    const entryPrefix = `${prefix}${key}.`;
    for (const editPath of Object.keys(edits)) {
      if (editPath.startsWith(entryPrefix))
        keys.add(editPath.slice(entryPrefix.length).split('.')[0]);
    }
    return keys;
  };

  /** Unhide a saved hide, or drop a pending one. */
  const unhideFor = (hidePath: string, pending: boolean) => {
    if (pending) return () => discard(hidePath);
    return onUnhideField ? () => onUnhideField(hidePath) : undefined;
  };

  /**
   * Why a card's fields are read-only: a dotted name the admin API drops, a
   * stdio server (LibreChat applies no override to it, so overrides stored
   * anyway can only be removed), or an inherited server not overridden yet.
   */
  const readOnlyNoteFor = (key: string, reason: ReadOnlyReason | null, overrides: number) => {
    if (reason === 'dotted') {
      return <McpNote tone="lock">{localize('com_config_mcp_dotted_name')}</McpNote>;
    }
    if (reason === 'process') {
      const canRemove = overrides > 0 && !disabled && !list.reverted.has(key);
      return (
        <McpNote
          tone="lock"
          actions={
            canRemove ? (
              <Button
                htmlType="button"
                type="secondary"
                label={localize('com_config_mcp_process_remove_overrides')}
                onClick={() => handleRevertAll(key)}
              />
            ) : undefined
          }
        >
          {localize(
            overrides > 0
              ? 'com_config_mcp_process_ignored_overrides'
              : 'com_config_mcp_process_read_only',
          )}
        </McpNote>
      );
    }
    if (reason !== 'inherited' || disabled) return undefined;
    return (
      <McpNote
        tone="info"
        actions={
          <Button
            htmlType="button"
            type="secondary"
            label={localize('com_config_mcp_override_fields', { scope: scopeName })}
            onClick={() => handleOverride(key)}
          />
        }
      >
        {localize('com_config_mcp_inherited_note', { scope: scopeName })}
      </McpNote>
    );
  };

  const readOnlyReason = (key: string, value: t.ConfigRecord, overrides: number) => {
    if (key.includes('.')) return 'dotted';
    if (isProcessMCPServerConfig(value)) return 'process';
    return isInheritedReadOnly(key, overrides) ? 'inherited' : null;
  };

  return (
    <ConfiguredOnlyContext.Provider value={Boolean(showConfiguredOnly)}>
      <div className="flex flex-col gap-2">
        {!disabled && (
          <div className="flex flex-wrap items-center gap-3 py-2">
            <button type="button" onClick={() => setCreateOpen(true)} className="config-add-btn">
              <DecorativeIcon name="plus" size="sm" />
              <span>{localize('com_config_create_mcp_server')}</span>
            </button>
          </div>
        )}
        {isEmpty && (
          <p className="py-2 text-sm text-(--cui-color-text-muted)">
            {localize(
              showConfiguredOnly && inScope
                ? 'com_config_mcp_none_in_scope'
                : 'com_config_no_mcp_servers',
              { scope: scopeName },
            )}
          </p>
        )}
        {visibleRows.map((row) => {
          if (row.kind === 'deleted') {
            return (
              <McpDeletedRow
                key={`deleted-${row.key}`}
                serverKey={row.key}
                focusUndo={lastDeleted === row.key}
                onUndo={() => handleUndoDelete(row.key)}
              />
            );
          }
          if (row.kind === 'hidden') {
            const hidePath = `${prefix}${row.key}`;
            return (
              <McpHiddenRow
                key={`hidden-${row.key}`}
                serverKey={row.key}
                pending={row.pending}
                onUnhide={disabled ? undefined : unhideFor(hidePath, row.pending)}
              />
            );
          }
          const { key, value } = row;
          const badges = badgesFor(key);
          const reason = readOnlyReason(key, value, badges.overrides);
          const readOnly = Boolean(disabled) || reason != null;
          const missingSecrets = missingSecretsOf(key, value);
          return (
            <McpServerCard
              key={key}
              serverKey={key}
              path={path}
              value={value}
              badges={badges}
              actions={actionsFor(key, value, badges.overrides)}
              readOnly={readOnly}
              readOnlyNote={readOnlyNoteFor(key, reason, badges.overrides)}
              renaming={renaming === key}
              onRenameCommit={(next) => handleRename(key, next)}
              onRenameCancel={() => setRenaming(null)}
              defaultExpanded={justAdded === key}
            >
              {renamedFrom[key] && (
                <McpNote tone="info">
                  {localize('com_config_mcp_renamed_from', { name: renamedFrom[key] })}
                </McpNote>
              )}
              {!readOnly && missingSecrets.length > 0 && (
                <McpNote tone="info">
                  {localize('com_config_mcp_duplicate_secrets', {
                    fields: missingSecrets
                      .map((secret) => labelForPath(`${path}.{}.${secret}`, localize))
                      .join(', '),
                  })}
                </McpNote>
              )}
              <McpServerEditor
                fields={fields}
                entryPath={`${prefix}${key}`}
                entry={value}
                lower={isConfigRecord(lower[key]) ? lower[key] : undefined}
                onChange={(leaf, next) => onChange(`${prefix}${key}.${leaf}`, next)}
                onSwitch={(plan) => applyPlan(key, plan)}
                onDiscard={onDiscardField}
                disabled={readOnly}
                typeLocked={lowerKeys.has(key) || transportOf(value) === 'stdio'}
                quiet={badges.isNew}
                owned={!lowerKeys.has(key)}
                ownKeys={inScope ? ownKeysOf(key) : undefined}
                editSessionId={editSessionId}
              />
            </McpServerCard>
          );
        })}
        <CreateMcpServerDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreate={handleCreate}
          onOverride={handleOverride}
          onUnhide={(key) => onUnhideField?.(`${prefix}${key}`)}
          fields={fields}
          existingKeys={allKeys}
          inheritedKeys={inScope ? lowerKeys : EMPTY_KEYS}
          hiddenKeys={new Set(hidden.keys())}
        />
      </div>
    </ConfiguredOnlyContext.Provider>
  );
}
