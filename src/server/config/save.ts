import { z } from 'zod';
import { createServerFn } from '@tanstack/react-start';
import { PrincipalType } from 'librechat-data-provider';
import { SystemCapabilities } from '@librechat/data-schemas/capabilities';
import type * as t from '@/types';
import {
  toBatchOps,
  verifyWrite,
  getEntryKey,
  reportedPath,
  uniqueSkipped,
  isConfigRecord,
  getValueAtPath,
  readWriteReport,
  readBatchReport,
  usesChangeBatch,
  createPathIndex,
  describeApiError,
  planConfigChanges,
  describeIssueCode,
  pathIndexOverlaps,
  getKeyedCollection,
  getWriteSkipReason,
  classifyReportedIssue,
  toRevisionPrecondition,
  stripSecretPreviewValues,
} from '@/utils';
import {
  getWriteRules,
  getConfigSection,
  MERGED_BACK_REASONS,
  VERSION_CONFLICT_CODE,
  TOO_MANY_CHANGES_CODE,
  TERMS_NOT_ACCEPTED_CODE,
  TERMS_NOT_ACCEPTED_ISSUE,
} from '@/constants';
import {
  requireCapability,
  requireAnyCapability,
  requireAllSectionCapabilities,
} from '../capabilities';
import { apiErrorMessage, apiFetch } from '../utils/api';
import { BASE_CONFIG_PRINCIPAL_ID } from '../constants';
import { MISSING_SCOPE_MESSAGE } from '../scopes/read';
import { normalizeAppServiceKeys } from './normalize';
import { safeFieldPath } from '../utils/validation';
import { getApiBaseUrl } from '../utils/url';
import { readConfigContract } from './meta';
import { getSchemaPathSet } from './schema';

export { parseIndexedArrayPath } from '@/utils';

/** How long to wait before re-reading the effective config once (LibreChat clears its caches asynchronously). */
const VERIFY_RETRY_MS = 400;

/**
 * Entries of a PATCH batch that LibreChat did not store. A 200 "No actionable
 * field entries" reply means it stripped the whole batch. Otherwise the reply
 * carries the stored overrides, and an entry whose top-level section is absent
 * from them was stripped (LibreChat strips by section: base-only, dedicated
 * and newer sections this panel does not know about yet).
 */
export function findDroppedEntries(batch: t.SaveEntry[], body: t.PatchFieldsResponse): string[] {
  if (body.message?.startsWith('No actionable')) return batch.map((e) => e.fieldPath);
  const overrides = body.config?.overrides;
  if (!isConfigRecord(overrides)) return [];
  return batch
    .filter((e) => !Object.hasOwn(overrides, getConfigSection(e.fieldPath)))
    .map((e) => e.fieldPath);
}

function targetConfigUrl(target: t.WriteTargetRef): string {
  if (target.type === 'base') return `/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}`;
  const { principalType, principalId } = target.scope;
  return `/api/admin/config/${principalType}/${encodeURIComponent(principalId)}`;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

/**
 * The target's stored overrides (redacted by the admin API), tombstones and
 * revision (`expectedRevision`); none, and a `null` revision, when base has
 * no config yet. A profile whose document is gone is refused (PR-3): the
 * admin API would otherwise silently recreate it, active and at the default
 * priority.
 */
async function readStoredLayer(
  target: t.WriteTargetRef,
): Promise<Pick<t.WriteSnapshot, 'stored' | 'tombstones' | 'revision'>> {
  const response = await apiFetch(targetConfigUrl(target));
  if (response.status === 404 && target.type === 'scope') throw new Error(MISSING_SCOPE_MESSAGE);
  if (response.status === 404) return { stored: {}, tombstones: [], revision: null };
  if (!response.ok) throw new Error(`Failed to read the stored config: ${response.status}`);
  const { config } = await readJson<t.AdminConfigDocResponse>(response);
  return {
    stored: normalizeAppServiceKeys((config?.overrides ?? {}) as t.ConfigRecord),
    tombstones: config?.tombstones ?? [],
    ...(typeof config?.revision === 'string' && { revision: config.revision }),
  };
}

/** The target's stored overrides (see `readStoredLayer`). */
async function readStoredOverrides(target: t.WriteTargetRef): Promise<t.ConfigRecord> {
  return (await readStoredLayer(target)).stored;
}

/** The base config: merged with the base overrides, or librechat.yaml alone (`baseOnly`). */
async function readBaseConfig(baseOnly: boolean): Promise<t.ConfigRecord> {
  const response = await apiFetch(`/api/admin/config/base${baseOnly ? '?baseOnly=true' : ''}`);
  if (!response.ok) throw new Error(`Failed to read the base config: ${response.status}`);
  const { config } = await readJson<{ config: t.ConfigRecord }>(response);
  return normalizeAppServiceKeys(config ?? {});
}

/**
 * The layers a write is planned against, read fresh: the target's stored
 * overrides and tombstones and the layer beneath it (librechat.yaml for base,
 * the merged base config for a profile).
 */
async function readWriteSnapshot(target: t.WriteTargetRef): Promise<t.WriteSnapshot> {
  const isBase = target.type === 'base';
  const [own, lower] = await Promise.all([readStoredLayer(target), readBaseConfig(isBase)]);
  return { ...own, lower, lowerKind: isBase ? 'yaml' : 'inherited' };
}

async function authorizeWrite(
  target: t.WriteTargetRef,
  ops: t.ConfigChange[],
  rules: t.ConfigWriteRules,
): Promise<void> {
  if (target.type === 'scope') {
    await requireAnyCapability([
      SystemCapabilities.ASSIGN_CONFIGS,
      SystemCapabilities.MANAGE_CONFIGS,
    ]);
    return;
  }
  const sections = [
    ...new Set(
      ops
        .filter((op) => !getWriteSkipReason(op.path, op.op === 'reset', rules))
        .map((op) => getConfigSection(op.path)),
    ),
  ];
  if (sections.length > 0) await requireAllSectionCapabilities(sections);
}

/** Masked secret previews never travel back as values. */
function sanitizeOps(ops: t.ConfigChange[]): t.ConfigChange[] {
  const schemaPaths = getSchemaPathSet();
  return ops.map((op) => {
    if (op.op === 'set') {
      return { ...op, value: stripSecretPreviewValues(op.value, op.path, schemaPaths) };
    }
    if (op.op !== 'upsertEntry') return op;
    return {
      ...op,
      value: stripSecretPreviewValues(op.value, op.path, schemaPaths),
      baseline:
        op.baseline === undefined
          ? undefined
          : stripSecretPreviewValues(op.baseline, op.path, schemaPaths),
    };
  });
}

/** Whether `segments` start with `prefix`. */
function startsWith(segments: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= segments.length && prefix.every((segment, i) => segments[i] === segment);
}

/**
 * A rejected value the admin API reported. Its location is read key by key
 * where the server reports `segments` (`dottedKeys`), so a record key that
 * holds a dot stays one key; the issue shows on that key's record. An index
 * inside a keyed collection is mapped to the identity of that sent entry,
 * since it indexes the array that was sent. With `issueParams` the issue's
 * bounds and options word it ("must be at least 1"); without them a code
 * whose message needs one (`too_small`'s minimum) is worded without it.
 */
function attributeBackendIssue(
  issue: t.ReportedIssue,
  batch: t.SaveEntry[],
  features: t.ConfigFeatures,
): t.ConfigIssue {
  const segments =
    features.dottedKeys && Array.isArray(issue.segments)
      ? issue.segments
      : (issue.path ?? '').split('.');
  const path = reportedPath({ path: issue.path, segments });
  const params = features.issueParams ? issue.params : undefined;
  const described = classifyReportedIssue(issue.code, params);
  const message = describeIssueCode(described.code, described.params, 'is not a valid value');
  const reported: t.ConfigIssue = {
    path,
    code: params ? described.code : issue.code,
    message,
    ...(described.params && { params: described.params }),
  };
  const sent = batch.find(({ fieldPath }) => startsWith(segments, fieldPath.split('.')));
  const collection = sent ? getKeyedCollection(sent.fieldPath) : undefined;
  const depth = sent ? sent.fieldPath.split('.').length : 0;
  if (!sent || !collection || !Array.isArray(sent.value) || segments.length === depth) {
    return reported;
  }
  const [index, ...rest] = segments.slice(depth);
  const identity = getEntryKey(sent.value[Number(index)], collection.key);
  return { ...reported, entryIdentity: identity, entryPath: reportedPath({ segments: rest }) };
}

async function failureIssues(
  response: Response,
  path: string,
  features: t.ConfigFeatures,
  batch: t.SaveEntry[] = [],
): Promise<t.ConfigIssue[]> {
  const body = await readJson<t.PatchFieldsResponse & { section?: string }>(response);
  return describeFailure(body, response.status, path, features, batch);
}

/** A refused write as issues: the values it rejected, else the refusal itself, located at `path`. */
function describeFailure(
  body: t.PatchFieldsResponse & { section?: string },
  status: number,
  path: string,
  features: t.ConfigFeatures,
  batch: t.SaveEntry[],
): t.ConfigIssue[] {
  if (Array.isArray(body.issues) && body.issues.length > 0) {
    return body.issues.map((issue) => attributeBackendIssue(issue, batch, features));
  }
  if (body.code === TERMS_NOT_ACCEPTED_CODE) {
    return [
      {
        path: '',
        code: TERMS_NOT_ACCEPTED_ISSUE,
        message: body.message ?? 'Terms of service must be accepted',
        params: { url: getApiBaseUrl() },
      },
    ];
  }
  const message =
    describeApiError(body) ??
    body.error ??
    body.message ??
    `The admin API rejected the change (${status})`;
  return [
    { path, code: body.code === VERSION_CONFLICT_CODE ? body.code : 'WRITE_FAILED', message },
  ];
}

interface WriteOutcome {
  writes: t.AppliedWrite[];
  /** Writes that did not take effect: they are not counted as applied. */
  dropped: t.SkippedChange[];
  /** Parts of an applied write the server reported it did not store, or stores without effect. */
  reported: t.SkippedChange[];
  failure?: t.ConfigIssue[];
}

/**
 * Files what a write's reply reports (`readWriteReport`, `readBatchReport`,
 * for the locations the save changes): a location the write addressed as a
 * whole is `dropped`, a part of it only `reported`. Before `writeReport`, a
 * PATCH's dropped entries are read from the stored sections
 * (`findDroppedEntries`).
 */
function fileWriteReport(
  outcome: Pick<WriteOutcome, 'dropped' | 'reported'>,
  items: t.SkippedChange[],
  written: readonly string[],
): void {
  const whole = new Set(written);
  for (const item of items) {
    (whole.has(item.fieldPath) ? outcome.dropped : outcome.reported).push(item);
  }
}

/** Sets in PATCHes of at most the server's `maxPatchEntries` entries each. */
async function patchFields(
  target: t.WriteTargetRef,
  entries: t.SaveEntry[],
  outcome: WriteOutcome,
  contract: t.ConfigContract,
  changed: t.PathIndex,
): Promise<boolean> {
  const { features } = contract;
  const maxEntries = contract.limits.maxPatchEntries;
  const priority = target.type === 'base' ? { priority: 0 } : {};
  for (let i = 0; i < entries.length; i += maxEntries) {
    const batch = entries.slice(i, i + maxEntries);
    const response = await apiFetch(`${targetConfigUrl(target)}/fields`, {
      method: 'PATCH',
      body: JSON.stringify({ entries: batch, ...priority }),
    });
    if (!response.ok) {
      outcome.failure = await failureIssues(response, batch[0].fieldPath, features, batch);
      return false;
    }
    const body = await readJson<t.PatchFieldsResponse>(response);
    const paths = batch.map(({ fieldPath }) => fieldPath);
    outcome.writes.push(...paths.map((path) => ({ kind: 'set' as const, path })));
    if (!features.writeReport) {
      outcome.dropped.push(
        ...findDroppedEntries(batch, body).map((fieldPath) => ({
          fieldPath,
          reason: 'notStored' as const,
        })),
      );
    }
    fileWriteReport(outcome, readWriteReport(body, features, changed), paths);
  }
  return true;
}

function fieldRequest(
  target: t.WriteTargetRef,
  kind: Exclude<t.AppliedWrite['kind'], 'set'>,
  path: string,
): Promise<Response> {
  if (kind === 'tombstone') {
    return apiFetch(`${targetConfigUrl(target)}/fields/tombstone`, {
      method: 'POST',
      body: JSON.stringify({ fieldPath: path }),
    });
  }
  return apiFetch(`${targetConfigUrl(target)}/fields?fieldPath=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
}

async function writeFieldOps(
  target: t.WriteTargetRef,
  kind: Exclude<t.AppliedWrite['kind'], 'set'>,
  paths: string[],
  outcome: WriteOutcome,
  features: t.ConfigFeatures,
  changed: t.PathIndex,
): Promise<boolean> {
  for (const path of paths) {
    const response = await fieldRequest(target, kind, path);
    if (!response.ok && !(response.status === 404 && kind !== 'tombstone')) {
      outcome.failure = await failureIssues(response, path, features);
      return false;
    }
    outcome.writes.push({ kind, path });
    if (response.ok) {
      const body = await readJson<t.PatchFieldsResponse>(response);
      fileWriteReport(outcome, readWriteReport(body, features, changed), [path]);
    }
  }
  return true;
}

/**
 * Before `changesBatch`, writes a plan as separate field writes in a fixed
 * order: untombstones, tombstones, then every set (one PATCH per
 * `maxPatchEntries` entries), then resets. An untombstone removes everything
 * at and under its path, so it goes first: after them, it would remove a set
 * or tombstone inside it (an MCP server shown again with its URL edited).
 * Tombstones precede sets because LibreChat validates a PATCH against the
 * layer beneath minus the target's stored tombstones: switching
 * `memory.agent` from a librechat.yaml `id` to an inline provider/model only
 * validates once `memory.agent.id` is hidden. Sets precede resets, so a
 * rename writes the new entry before removing the old one. Stops at the
 * first failure.
 */
async function executePlan(
  target: t.WriteTargetRef,
  plan: t.WritePlan,
  contract: t.ConfigContract,
): Promise<WriteOutcome> {
  const outcome: WriteOutcome = { writes: [], dropped: [], reported: [] };
  const { features } = contract;
  const changed = createPathIndex(plan.changed);
  const steps = [
    () => writeFieldOps(target, 'untombstone', plan.untombstones, outcome, features, changed),
    () => writeFieldOps(target, 'tombstone', plan.tombstones, outcome, features, changed),
    () => patchFields(target, plan.sets, outcome, contract, changed),
    () => writeFieldOps(target, 'reset', plan.resets, outcome, features, changed),
  ];
  try {
    for (const step of steps) {
      if (!(await step())) break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outcome.failure = [{ path: '', code: 'WRITE_FAILED', message }];
  }
  return outcome;
}

async function restorePath(
  target: t.WriteTargetRef,
  path: string,
  previous: t.ConfigValue,
): Promise<boolean> {
  if (previous === undefined) {
    const response = await fieldRequest(target, 'reset', path);
    return response.ok || response.status === 404;
  }
  const value = stripSecretPreviewValues(previous, path, getSchemaPathSet());
  const response = await apiFetch(`${targetConfigUrl(target)}/fields`, {
    method: 'PATCH',
    body: JSON.stringify({ entries: [{ fieldPath: path, value }] }),
  });
  return response.ok;
}

async function undoWrite(
  target: t.WriteTargetRef,
  write: t.AppliedWrite,
  captured: t.ConfigRecord,
): Promise<boolean> {
  const previous = getValueAtPath(captured, write.path);
  if (write.kind === 'untombstone') return (await fieldRequest(target, 'tombstone', write.path)).ok;
  if (write.kind === 'reset' && previous === undefined) return true;
  if (write.kind === 'tombstone') {
    const response = await fieldRequest(target, 'reset', write.path);
    if (!response.ok) return false;
    return previous === undefined || restorePath(target, write.path, previous);
  }
  return restorePath(target, write.path, previous);
}

/**
 * Rolls written changes back to the overrides captured before the write, in
 * reverse order. Best effort: a stored secret cannot be restored, since the
 * admin API never returns it (a secret the failed batch wrote stays).
 */
async function compensate(
  target: t.WriteTargetRef,
  writes: t.AppliedWrite[],
  captured: t.ConfigRecord,
): Promise<boolean> {
  let restored = true;
  for (const write of [...writes].reverse()) {
    try {
      restored = (await undoWrite(target, write, captured)) && restored;
    } catch {
      restored = false;
    }
  }
  return restored;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Changes that did not take effect, read back after the write (best effort: a failed read reports none). */
async function verifyTarget(
  target: t.WriteTargetRef,
  plan: t.WritePlan,
  snapshot: t.WriteSnapshot,
): Promise<t.SkippedChange[]> {
  try {
    const stored = await readStoredOverrides(target);
    if (target.type !== 'base') return verifyWrite(plan, snapshot, stored);
    const first = verifyWrite(plan, snapshot, stored, await readBaseConfig(false));
    if (!first.some((item) => item.reason === 'notApplied')) return first;
    await delay(VERIFY_RETRY_MS);
    return verifyWrite(plan, snapshot, stored, await readBaseConfig(false));
  } catch {
    return [];
  }
}

function hasWrites(plan: t.WritePlan): boolean {
  return (
    plan.sets.length + plan.resets.length + plan.tombstones.length + plan.untombstones.length > 0
  );
}

/** What a plan reports before anything is written. */
function planResult(plan: t.WritePlan): t.ApplyConfigChangesResult {
  return {
    applied: 0,
    failed: [],
    warnings: plan.warnings,
    issues: plan.issues,
    skipped: plan.skipped,
    reported: [],
  };
}

/**
 * A written plan's result: the input changes that took effect (every change
 * not reported or found ineffective, merged-back keys aside), each that did
 * not, with why (`skipped`), and apart from them the parts of written ones
 * the server reported (`reported`, once each however many writes repeat them).
 */
function writtenResult(
  plan: t.WritePlan,
  reported: Pick<WriteOutcome, 'dropped' | 'reported'>,
  verified: t.SkippedChange[],
): t.ApplyConfigChangesResult {
  const notEffective = [...reported.dropped, ...verified];
  const lost = new Set(
    notEffective
      .filter((item) => !MERGED_BACK_REASONS.has(item.reason))
      .map((item) => item.fieldPath),
  );
  return {
    ...planResult(plan),
    applied: Math.max(0, plan.effective - lost.size),
    skipped: [...plan.skipped, ...notEffective],
    reported: uniqueSkipped(reported.reported),
  };
}

/**
 * Before `changesBatch`: tombstones, sets, then resets as separate field
 * writes; if a write fails, the writes before it are rolled back to the
 * captured overrides. Afterwards the stored (and, for base, effective)
 * config is read back for what did not take effect.
 */
async function applyFieldWrites(
  target: t.WriteTargetRef,
  plan: t.WritePlan,
  snapshot: t.WriteSnapshot,
  contract: t.ConfigContract,
): Promise<t.ApplyConfigChangesResult> {
  const outcome = await executePlan(target, plan, contract);
  if (outcome.failure) {
    const compensated = await compensate(target, outcome.writes, snapshot.stored);
    return { ...planResult(plan), failed: outcome.failure, compensated };
  }
  const reportedPaths = new Set(
    [...outcome.dropped, ...outcome.reported].map((item) => item.fieldPath),
  );
  /** What the server reported is worded by its reasons; a read-back finding at the same path is the same change. */
  const verified = (await verifyTarget(target, plan, snapshot)).filter(
    (item) => !reportedPaths.has(item.fieldPath),
  );
  return writtenResult(plan, outcome, verified);
}

interface BatchOutcome extends Pick<WriteOutcome, 'dropped' | 'reported' | 'failure'> {
  /** 409: the target is no longer at the revision the batch named. */
  conflict?: boolean;
  /** A batch failed after earlier batches of the plan were written. */
  partial?: boolean;
  /** The target's stored overrides after the last batch, as its reply returned them. */
  stored?: t.ConfigRecord;
}

/** A refused batch as issues, located at the change it names (`opIndex`). */
function batchFailure(
  body: t.ChangesBatchResponse & { section?: string },
  status: number,
  ops: t.ConfigBatchOp[],
  features: t.ConfigFeatures,
): t.ConfigIssue[] {
  const refused = body.opIndex === undefined ? undefined : ops[body.opIndex];
  const sets = ops.flatMap((op): t.SaveEntry[] =>
    op.op === 'set' ? [{ fieldPath: op.fieldPath, value: op.value }] : [],
  );
  return describeFailure(body, status, (refused ?? ops[0]).fieldPath, features, sets);
}

/** How many changes of a batch fall in each config section, in the order the sections first appear. */
function countSectionChanges(ops: t.ConfigBatchOp[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { fieldPath } of ops) {
    const section = getConfigSection(fieldPath);
    counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  return counts;
}

/** Sections packed in order into groups of at most `size` changes in all; a section is never split. */
function packSections(counts: ReadonlyMap<string, number>, size: number): string[][] {
  const groups: string[][] = [];
  let group: string[] = [];
  let filled = 0;
  for (const [section, count] of counts) {
    if (group.length > 0 && filled + count > size) {
      groups.push(group);
      group = [];
      filled = 0;
    }
    group.push(section);
    filled += count;
  }
  if (group.length > 0) groups.push(group);
  return groups;
}

function tooManyChangesIssue(section: string, count: number, limit: number): t.ConfigIssue {
  const params = { count, limit };
  return {
    path: section,
    code: TOO_MANY_CHANGES_CODE,
    message: describeIssueCode(TOO_MANY_CHANGES_CODE, params, 'has too many changes for one save'),
    params,
  };
}

/**
 * The batches a plan is sent in: one, or for a plan above `maxChangeOps`, one
 * per group of whole config sections. LibreChat judges each batch on its own
 * end state, section by section, so the changes of one section (a hide and
 * the values that replace it, an entry and the settings that depend on it)
 * always go together. Each batch is planned again from its sections' changes,
 * against the layers as read (the batches before it write other sections
 * only), and sent as that plan writes it. Nothing is written, and the refused
 * save's result is returned instead, when one section alone holds more
 * changes than a batch takes or a batch's own plan finds an issue.
 */
function splitPlan(
  changes: t.ConfigChange[],
  plan: t.WritePlan,
  snapshot: t.WriteSnapshot,
  contract: t.ConfigContract,
  rules: t.ConfigWriteRules,
): t.ConfigBatchOp[][] | t.ApplyConfigChangesResult {
  const ops = toBatchOps(plan);
  const size = contract.limits.maxChangeOps;
  if (size <= 0 || ops.length <= size) return [ops];
  const counts = countSectionChanges(ops);
  const oversized = [...counts]
    .filter(([, count]) => count > size)
    .map(([section, count]) => tooManyChangesIssue(section, count, size));
  if (oversized.length > 0) return { ...planResult(plan), failed: oversized };
  const batches = packSections(counts, size).map((sections) => {
    const included = new Set(sections);
    const own = changes.filter((change) => included.has(getConfigSection(change.path)));
    return planConfigChanges(own, snapshot, contract.features, rules);
  });
  const issues = batches.flatMap((batch) => batch.issues);
  if (issues.length > 0) return { ...planResult(plan), issues };
  return batches.map(toBatchOps);
}

/**
 * Writes a plan's batches (`splitPlan`) as `POST …/changes` requests
 * (`changesBatch`), each named by the revision the one before it left. A
 * batch applies whole or not at all, so nothing is rolled back by hand; a
 * failure after earlier batches were written is `partial`.
 */
async function writeBatches(
  target: t.WriteTargetRef,
  batches: t.ConfigBatchOp[][],
  plan: t.WritePlan,
  contract: t.ConfigContract,
  revision: string | undefined,
): Promise<BatchOutcome> {
  const changed = createPathIndex(plan.changed);
  const priority = target.type === 'base' ? { priority: 0 } : {};
  const outcome: BatchOutcome = { dropped: [], reported: [] };
  let expected = revision;
  let index = 0;
  try {
    for (; index < batches.length; index++) {
      const batch = batches[index];
      const response = await apiFetch(`${targetConfigUrl(target)}/changes`, {
        method: 'POST',
        body: JSON.stringify({
          ops: batch,
          ...priority,
          ...(expected !== undefined && { expectedRevision: expected }),
        }),
      });
      const body = await readJson<t.ChangesBatchResponse & { section?: string }>(response);
      if (!response.ok) {
        outcome.conflict = response.status === 409 && body.code === VERSION_CONFLICT_CODE;
        outcome.failure = batchFailure(body, response.status, batch, contract.features);
        outcome.partial = index > 0;
        return outcome;
      }
      const written = batch.map(({ fieldPath }) => fieldPath);
      fileWriteReport(outcome, readBatchReport(body, changed), written);
      expected = toRevisionPrecondition(body.revision);
      const stored = body.config?.overrides;
      if (isConfigRecord(stored)) outcome.stored = normalizeAppServiceKeys(stored);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outcome.failure = [{ path: '', code: 'WRITE_FAILED', message }];
    outcome.partial = index > 0;
  }
  return outcome;
}

/**
 * What a written batch did not make take effect beyond what its reply
 * reported: the stored overrides the reply returned, checked against the
 * plan, and for Base the effective config, read once where the server
 * clears its caches before replying (`awaitedInvalidation`). A finding at,
 * inside or around a location the reply reported is that same change.
 */
async function verifyBatch(
  target: t.WriteTargetRef,
  plan: t.WritePlan,
  snapshot: t.WriteSnapshot,
  outcome: BatchOutcome,
  features: t.ConfigFeatures,
): Promise<t.SkippedChange[]> {
  const reported = createPathIndex(
    [...outcome.dropped, ...outcome.reported].map((item) => item.fieldPath),
  );
  const readsEffective = target.type === 'base' && features.awaitedInvalidation;
  const effective = readsEffective ? await readBaseConfig(false).catch(() => undefined) : undefined;
  return verifyWrite(plan, snapshot, outcome.stored ?? plan.storedAfter, effective).filter(
    (item) => !pathIndexOverlaps(reported, item.fieldPath),
  );
}

const CONFLICT_ISSUE: t.ConfigIssue = {
  path: '',
  code: VERSION_CONFLICT_CODE,
  message:
    describeApiError({ code: VERSION_CONFLICT_CODE }) ?? 'The configuration changed elsewhere',
};

/** The result of a save that found the target changed since `expectedRevision`: nothing was written. */
function conflictResult(plan?: t.WritePlan): t.ApplyConfigChangesResult {
  const result = plan
    ? planResult(plan)
    : { applied: 0, warnings: [], issues: [], skipped: [], reported: [] };
  return { ...result, failed: [CONFLICT_ISSUE], conflict: true };
}

/**
 * With `changesBatch`: the plan is written as one `POST …/changes` batch
 * (`writeBatches`) named by the revision it was planned against, or above
 * `maxChangeOps` as batches of whole sections (`splitPlan`). The edits were
 * made against `expectedRevision`: when the target is stored at another
 * revision now, or a write lands between the read and the batch (409),
 * nothing is written and the result is a `conflict`. Without one (an import),
 * a batch that loses that race is planned and sent once more. A 409 on a
 * later batch of a split save is `partiallyWritten`, not a conflict: the
 * batches before it stay saved.
 */
async function applyBatch(
  target: t.WriteTargetRef,
  ops: t.ConfigChange[],
  contract: t.ConfigContract,
  rules: t.ConfigWriteRules,
  expectedRevision: string | undefined,
): Promise<t.ApplyConfigChangesResult> {
  const changes = sanitizeOps(ops);
  for (let attempt = 0; ; attempt++) {
    const snapshot = await readWriteSnapshot(target);
    const revision = toRevisionPrecondition(snapshot.revision);
    const comparable = revision !== undefined && expectedRevision !== undefined;
    if (comparable && revision !== expectedRevision) {
      return conflictResult();
    }
    const plan = planConfigChanges(changes, snapshot, contract.features, rules);
    if (plan.issues.length > 0 || !hasWrites(plan)) return planResult(plan);
    const batches = splitPlan(changes, plan, snapshot, contract, rules);
    if (!Array.isArray(batches)) return batches;
    const outcome = await writeBatches(target, batches, plan, contract, revision);
    const retry = outcome.conflict && !outcome.partial && expectedRevision === undefined;
    if (retry && attempt === 0) continue;
    if (outcome.failure) {
      return {
        ...(outcome.conflict && !outcome.partial ? conflictResult(plan) : planResult(plan)),
        failed: outcome.failure,
        ...(outcome.partial && { partiallyWritten: true }),
      };
    }
    const verified = await verifyBatch(target, plan, snapshot, outcome, contract.features);
    return writtenResult(plan, outcome, verified);
  }
}

/**
 * The one write path for config changes (SV-1/SV-2/SV-4). Reads the target's
 * stored overrides and the layer beneath it, and the server's contract
 * (`readConfigContract`), plans the changes against them
 * (`planConfigChanges`: keyed collection ops by identity, validation of
 * fields, entries and whole sections, write rules), and writes nothing when
 * any issue is found. A server with `changesBatch` and `expectedRevision`
 * takes the plan as one atomic batch (`applyBatch`); an older one as
 * separate field writes (`applyFieldWrites`). Every change that did not take
 * effect is reported in `skipped`.
 */
export async function applyConfigChanges(
  target: t.WriteTargetRef,
  ops: t.ConfigChange[],
  expectedRevision?: string,
): Promise<t.ApplyConfigChangesResult> {
  const contract = await readConfigContract();
  const rules = getWriteRules(contract);
  await authorizeWrite(target, ops, rules);
  if (usesChangeBatch(contract.features)) {
    return applyBatch(target, ops, contract, rules, expectedRevision);
  }
  const snapshot = await readWriteSnapshot(target);
  const plan = planConfigChanges(sanitizeOps(ops), snapshot, contract.features, rules);
  if (plan.issues.length > 0 || !hasWrites(plan)) return planResult(plan);
  return applyFieldWrites(target, plan, snapshot, contract);
}

const writeTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('base') }),
  z.object({
    type: z.literal('scope'),
    scope: z
      .object({ principalType: z.nativeEnum(PrincipalType), principalId: z.string().min(1) })
      .passthrough(),
  }),
]);

const configChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), path: safeFieldPath, value: z.unknown() }),
  z.object({ op: z.literal('reset'), path: safeFieldPath }),
  z.object({ op: z.literal('tombstone'), path: safeFieldPath }),
  z.object({ op: z.literal('untombstone'), path: safeFieldPath }),
  z.object({
    op: z.literal('upsertEntry'),
    path: safeFieldPath,
    key: z.string().min(1),
    identity: z.string().min(1).nullable(),
    value: z.unknown(),
    baseline: z.unknown().optional(),
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({
    op: z.literal('removeEntry'),
    path: safeFieldPath,
    key: z.string().min(1),
    identity: z.string().min(1),
  }),
]);

/**
 * Applies a batch of config changes to base or a profile, all or nothing,
 * unless the target changed since `expectedRevision` (see `applyConfigChanges`).
 */
export const applyConfigChangesFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      target: writeTargetSchema,
      ops: z.array(configChangeSchema).min(1).max(2000),
      expectedRevision: z.string().min(1).max(200).optional(),
    }),
  )
  .handler(
    ({ data }): Promise<t.ApplyConfigChangesResult> =>
      applyConfigChanges(
        data.target as t.WriteTargetRef,
        data.ops as t.ConfigChange[],
        data.expectedRevision,
      ),
  );

/** Deletes the entire base config DB override, reverting every value back to
 *  what librechat.yaml defines. Removes the `__base__` config document outright;
 *  scope (role/group/user) profiles are untouched. A 404 means there was no
 *  override to begin with, which is treated as success. */
export const resetBaseConfigFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireCapability(SystemCapabilities.MANAGE_CONFIGS);
  const response = await apiFetch(`/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}`, {
    method: 'DELETE',
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(await apiErrorMessage(response, 'Failed to reset base config'));
  }

  return { success: true };
});
