import type { ReactNode } from 'react';
import type { SaveEntry, WriteTarget, SaveContext, SavePayload, SkippedChange } from './config-ui';
import type { ConfigValue, ConfigRecord, FlatConfigMap, ZodSchemaLike } from './config';
import type { RevertTarget } from './values';
import type { ConfigScope } from './scope';

/** One write operation of the save pipeline (WS1). */
export type ConfigChange =
  | { op: 'set'; path: string; value: ConfigValue }
  /** Removes the target's own override. */
  | { op: 'reset'; path: string }
  /** Hides (or unhides) a lower-layer value in the target. */
  | { op: 'tombstone' | 'untombstone'; path: string }
  /**
   * Creates or updates a keyed collection entry. `identity` is the entry's key
   * in the baseline the edit was made against (null for a new entry) and `key`
   * its key afterwards, so `key !== identity` is a rename. `baseline` is the
   * entry as the editor loaded it: only what changed since then is applied, on
   * top of the entry as it is stored at save time. `index` places a new entry
   * in a replace-semantics list (appended when absent), and moves an existing
   * one there (a reordered list sends every kept entry with its position).
   */
  | {
      op: 'upsertEntry';
      path: string;
      key: string;
      identity: string | null;
      value: ConfigValue;
      baseline?: ConfigValue;
      index?: number;
    }
  | { op: 'removeEntry'; path: string; key: string; identity: string };

/**
 * A validation or apply problem reported for a path (WS1). An issue inside a
 * keyed collection entry also names the entry (`entryIdentity`) and the path
 * inside it (`entryPath`), so it can be shown wherever the entry is displayed.
 */
export interface ConfigIssue {
  path: string;
  code?: string;
  message: string;
  entryIdentity?: string;
  /** Path inside the entry (`provider`, `models.default`); empty for the entry itself. */
  entryPath?: string;
  /** Values interpolated into the localized message for `code`. */
  params?: Record<string, string | number>;
}

/** A location in a config document as the admin API reports it. */
export interface ReportedLocation {
  /** Absent where the report names the location by `segments` only (a `/changes` op). */
  path?: string;
  /** The same location key by key: unambiguous where a record key holds a dot (`dottedKeys`). */
  segments?: string[];
}

/** Bounds and options of an issue the admin API reports (`issueParams`); never a submitted value. */
export interface ReportedIssueParams {
  expected?: string | number | boolean | null;
  received?: string;
  options?: Array<string | number | boolean | null>;
  minimum?: number;
  maximum?: number;
  inclusive?: boolean;
  exact?: boolean;
  type?: string;
  validation?: string;
  multipleOf?: number;
  /** A refinement's stable reason (`missing_port`). */
  reason?: string;
}

/** A rejected value the admin API reports: where, a stable code, and (`issueParams`) its bounds. */
export interface ReportedIssue extends ReportedLocation {
  code: string;
  params?: ReportedIssueParams;
}

/** A location a write did not store (`skipped`) or stores without effect (`ignored`), and why. */
export interface ReportedSkip extends ReportedLocation {
  reason: string;
  /** The change of a `POST …/changes` batch it belongs to, by position in the sent ops. */
  opIndex?: number;
}

/** One change of a `POST …/changes` batch as the panel sends it (`changesBatch`). */
export type ConfigBatchOp =
  | { op: 'set'; fieldPath: string; value: ConfigValue }
  /** Removes the target's override at the path, the objects that leaves empty and the tombstones at or below it. */
  | { op: 'unset' | 'tombstone'; fieldPath: string };

/** An admin API error reply: its text, and the stable `code` (and route details) newer servers add. */
export interface ApiErrorBody {
  error?: string;
  message?: string;
  code?: string;
  /** `FORBIDDEN_SECTION`: the section the caller may not manage. */
  section?: string;
}

/** Input of `applyConfigChangesFn` (WS1). */
export interface ApplyConfigChangesRequest {
  target: WriteTarget;
  ops: ConfigChange[];
  /**
   * The target's revision the edits were made against (`changesBatch`):
   * `absent` when it had no document. A save finds it changed elsewhere
   * (`conflict`) instead of writing over it.
   */
  expectedRevision?: string;
}

/** Warning attached to a change in the review (WS1 produces, WS7 renders). */
export type ChangeWarning =
  | 'ownershipChange'
  /** Empties a list where empty allows nothing (`supportedMimeTypes`, `allowedAddresses`). */
  | 'emptyAllowlist'
  /** Empties a list where empty sets no limit (`addedEndpoints`, `allowedProviders`, `allowedDomains`). */
  | 'openAllowlist'
  /** Empties the allowed sign-up domains, so anyone with an email address can sign up (WS14). */
  | 'openRegistration'
  | 'yamlOnly'
  | 'baseOnly'
  | 'unsafeKey'
  /** Removes or renames a collection entry librechat.yaml defines (WS7; blocks Save, see D1). */
  | 'yamlEntry'
  /** Sets a value Global (`endpoints.all`) takes precedence over, so it has no effect (D11). */
  | 'shadowed'
  /** Sets a provider title setting while Global exists, so LibreChat ignores it (D11). */
  | 'shadowedBlock'
  /** Global sets the other half of the title endpoint and model, chosen together (`titleResolution: 'field'`). */
  | 'shadowedPair'
  /** Turns on required acceptance of the terms, which also gates this admin's own changes (FX-5). */
  | 'requireTerms'
  /** Empties the model spec list: no specs, and Specs only has no effect (MS-1). */
  | 'emptySpecs';

/** A warning for one path (and entry), with the keys it concerns when relevant (WS1). */
export interface ConfigWarning {
  path: string;
  warning: ChangeWarning;
  entryIdentity?: string;
  /** e.g. the librechat.yaml keys an entry edit cannot remove. */
  keys?: string[];
}

/** Result of `applyConfigChangesFn` (WS1). */
export interface ApplyConfigChangesResult {
  /** Changes (ops) that were written. */
  applied: number;
  /** Write failures after the pre-flight passed; the written part was rolled back. */
  failed: ConfigIssue[];
  warnings: ConfigWarning[];
  /** Pre-flight issues; when any exist nothing was written. */
  issues: ConfigIssue[];
  /** Changes not sent (read-only, permission, …), not stored, or without effect, and why. */
  skipped: SkippedChange[];
  /**
   * Parts of written changes the server reported it did not store, or stores
   * without effect (a credential it drops): the change itself is written.
   */
  reported: SkippedChange[];
  /** A failed write was rolled back to the overrides captured before it (servers without `changesBatch`). */
  compensated?: boolean;
  /**
   * The target was saved elsewhere since the revision the edits were made
   * against (`expectedRevision`), so nothing was written.
   */
  conflict?: boolean;
  /** A save split into batches of `maxChangeOps` failed after earlier batches were written. */
  partiallyWritten?: boolean;
}

/** How a change reads in the review (WS1). */
export type ChangeKind =
  | 'added'
  | 'changed'
  | 'reverted'
  | 'removed'
  | 'hidden'
  | 'unhidden'
  | 'renamed';

/** One human-readable row of the change review (WS1 produces, WS7 renders). */
export interface ChangeSummaryItem {
  path: string;
  /**
   * The segments of `path` when a record key in it holds a dot (an inference
   * profile `us.anthropic.claude-sonnet-4-6`), which splitting `path` would
   * break apart; Revert follows them.
   */
  segments?: string[];
  /** Identity (e.g. name) of the collection entry the change belongs to. */
  entryIdentity?: string;
  kind: ChangeKind;
  before: ConfigValue;
  after: ConfigValue;
  revertTarget?: RevertTarget;
  secret?: boolean;
  warnings?: ChangeWarning[];
  /** The saved value changed since the edit was made (e.g. another admin saved meanwhile). */
  drift?: { current: ConfigValue };
  /** The pending edit this change comes from; Revert undoes it there (WS7). */
  sourcePath?: string;
  /** Path of the keyed collection the entry belongs to (`endpoints.custom`, `mcpServers`) (WS7). */
  collectionPath?: string;
  /** Data path of the entry itself (`endpoints.custom.3`, `mcpServers.github`) (WS7). */
  entryPath?: string;
  /** The entry's identity before a rename (WS7). */
  previousIdentity?: string;
}

/** How LibreChat layers a collection override over the value beneath it (WS1). */
export type CollectionMerge = 'byKey' | 'replace';

/** An array setting whose entries are identified by a key field (WS1). */
export interface KeyedCollection {
  path: string;
  /** Field holding each entry's identity (e.g. `name`). */
  key: string;
  /**
   * `byKey`: the override array is merged into the lower layer entry by entry,
   * and lower entries it does not mention are kept (`endpoints.custom`).
   * `replace`: the override array replaces the lower one whole.
   */
  merge: CollectionMerge;
  /** A secret stored on each entry, and its masked-preview companion. */
  secret?: { key: string; preview: string };
  /**
   * The name LibreChat serves an entry under, when that differs from its key
   * (custom endpoints: `Ollama` in any letter case is the one `ollama`). Two
   * entries with the same served name replace each other at runtime.
   */
  servedName?: (name: string) => string;
  /** Names LibreChat keeps for itself (its built-in endpoints). */
  reservedNames?: ReadonlySet<string>;
}

/** Where the layer beneath the write target comes from (WS1). */
export type LowerLayerKind = 'yaml' | 'inherited';

/** The layers a write is planned against (WS1). */
export interface WriteSnapshot {
  /** The target's own stored overrides (secrets redacted). */
  stored: ConfigRecord;
  /** Paths the target hides from the layer beneath (its stored tombstones). */
  tombstones: readonly string[];
  /** The layer beneath the target: librechat.yaml for base, the base config for a profile. */
  lower: ConfigRecord;
  lowerKind: LowerLayerKind;
  /**
   * The target's stored revision (`expectedRevision`): `null` when it has no
   * document, absent when the server does not report revisions.
   */
  revision?: string | null;
}

/** The admin API writes a batch of changes resolves to, and what blocks or limits it (WS1). */
export interface WritePlan {
  /** Field PATCHes. */
  sets: SaveEntry[];
  /** Field DELETEs (each removes the target's own override). */
  resets: string[];
  tombstones: string[];
  untombstones: string[];
  /** Changes that are not sent, and why. */
  skipped: SkippedChange[];
  /** Blocking problems: while any exist nothing may be written. */
  issues: ConfigIssue[];
  warnings: ConfigWarning[];
  /** The target's stored overrides once the plan is applied. */
  storedAfter: ConfigRecord;
  /** Input changes that produce at least one write. */
  effective: number;
  /**
   * Where the writes change the target: their paths, a keyed collection's by
   * the entries the changes touch (`endpoints.custom.Moonshot`, `entryLocation`)
   * rather than the whole list a write sends.
   */
  changed: string[];
}

/** The parts of a zod (v3) issue the save pipeline reads (WS1). */
export interface SchemaIssue {
  code: string;
  path: Array<string | number>;
  message: string;
  expected?: string | number | boolean | null;
  received?: string | number | boolean | null;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  type?: string;
  options?: Array<string | number>;
  validation?: string | Record<string, string>;
  unionErrors?: Array<{ issues: SchemaIssue[] }>;
}

/** What a schema's `safeParse` returns, as far as validation reads it (WS1). */
export interface SchemaParseResult {
  success: boolean;
  error?: { issues: SchemaIssue[] };
}

/** A schema that can validate a value (a Zod schema, as far as validation uses it). */
export type ParseableSchema = ZodSchemaLike & {
  safeParse(value: ConfigValue): SchemaParseResult;
};

/** A keyed collection entry change (WS1). */
export type EntryChange = Extract<ConfigChange, { op: 'upsertEntry' | 'removeEntry' }>;

/** One collection's entry changes and the layers they apply to (WS1). */
export interface CollectionOpsInput {
  collection: KeyedCollection;
  /** The target's own override array (undefined when it has none). */
  stored: ConfigValue;
  /** The value beneath the target (librechat.yaml for base, the base config for a profile). */
  lower: ConfigValue;
  lowerKind: LowerLayerKind;
  ops: EntryChange[];
}

/** What a collection's entry changes resolve to (WS1). */
export interface CollectionResolution {
  /** The target's own override afterwards (undefined: it keeps none). */
  next: ConfigValue[] | undefined;
  changed: boolean;
  issues: ConfigIssue[];
  warnings: ConfigWarning[];
  /** Changes that altered the collection. */
  effective: number;
}

/** The write target as the server needs it: base, or a profile's principal (WS1). */
export type WriteTargetRef =
  | { type: 'base' }
  | { type: 'scope'; scope: Pick<ConfigScope, 'principalType' | 'principalId'> };

/** A write the apply step performed, kept to roll it back if a later write fails (WS1). */
export interface AppliedWrite {
  kind: 'set' | 'reset' | 'tombstone' | 'untombstone';
  path: string;
}

/** The saved entry a pending collection item came from (WS1). */
export interface EntryOrigin {
  /** The entry's key (e.g. name) when the edit was made. */
  identity: string;
  /** The entry as it was loaded. */
  baseline: ConfigValue;
}

/** How a keyed collection's pending items relate to the collection as it was loaded (WS1). */
export interface CollectionEdit {
  /** The collection when its first edit was made: the baseline its edits are against. */
  baseline: ConfigValue[];
  /** For each item of the pending array, the loaded entry it came from (null: added). */
  origins: Array<EntryOrigin | null>;
  /** Loaded entries removed from the pending array, with their last pending value, so Undo restores their identity. */
  detached?: DetachedEntry[];
}

/** A loaded entry taken out of a pending collection (WS1). */
export interface DetachedEntry {
  /** The item as it was in the pending array when it was removed. */
  value: ConfigValue;
  origin: EntryOrigin;
}

/** Collection path → its `CollectionEdit` (WS1). */
export type CollectionEdits = Record<string, CollectionEdit>;

/** A pending hide (tombstone) or unhide of an inherited value (WS1). */
export type VisibilityEdit = 'hide' | 'unhide';

/** How an edit compares with the target's saved value, for dirty-state checks (WS1). */
export interface EditBaseline {
  /** The edit target's saved values, structured. */
  root: ConfigRecord | null;
  /** Whether a path is an array setting (so a numeric child segment is an index). */
  isArrayPath: (path: string) => boolean;
  /** A value at a path as Save would store it. */
  normalize: (path: string, value: ConfigValue) => ConfigValue;
}

/** One keyed collection's pending state, as `buildConfigChanges` resolved it (WS1). */
export interface PendingCollection {
  collection: KeyedCollection;
  /** The items shown on the page (pending edits applied). */
  items: ConfigValue[];
  edit: CollectionEdit;
}

/** Every pending change as `ConfigChange` ops, plus what the review and inline errors need (WS1). */
export interface ConfigChangeSet {
  ops: ConfigChange[];
  /** Saves and resets of non-collection paths, and the edits that are not sent. */
  payload: SavePayload;
  /** Problems found while building the ops (e.g. an entry without a name). */
  issues: ConfigIssue[];
  collections: PendingCollection[];
}

/** What `buildConfigChanges` needs besides `SaveContext` (WS1). */
export interface ChangeContext extends SaveContext {
  /** The edit target's saved values, structured. */
  root: ConfigRecord | null;
  collections: CollectionEdits;
  visibility?: Record<string, VisibilityEdit>;
}

/** The layers a change summary reads before/after values from (WS1). */
export interface SummaryLayers {
  /** The saved value the page shows (the edit target's view). */
  baselineAt: (path: string) => ConfigValue;
  /** The edit target's own stored override. */
  ownAt: (path: string) => ConfigValue;
  /** What a path falls back to once the target's override is removed. */
  revertAt: (path: string) => RevertTarget;
  /** Saved values captured when each path was first edited. */
  editBaselines: FlatConfigMap;
}

/** Displayed path → readable message of the issue there (WS1). */
export type PathErrors = Record<string, string>;

/** Props of `ConfigErrorsProvider` (WS1). */
export interface ConfigErrorsProviderProps {
  /** Memoize it: every `useFieldState` consumer re-renders when it changes. */
  value: PathErrors;
  children: ReactNode;
}
