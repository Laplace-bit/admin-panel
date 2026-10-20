import { EModelEndpoint } from 'librechat-data-provider';
import type * as t from '@/types';
import { isConfigRecord, getKeyedCollection } from '@/utils';

export const SPEC_LIST_PATH = 'modelSpecs.list';

/** Built-in providers a spec can name (`custom` is a type, not an endpoint). */
export const BUILT_IN_ENDPOINTS: readonly string[] = Object.values(EModelEndpoint).filter(
  (endpoint) => endpoint !== EModelEndpoint.custom,
);

/** English fallback of each issue code (the page shows `com_config_issue_<code>`). */
const ISSUE_TEXT: Record<string, string> = {
  required: 'is required',
  spec_multiple_default: 'Only one spec can be the default',
  spec_multiple_soft_default: 'Only one spec can be the soft default',
};

function textOf(value: t.ConfigValue): string {
  return typeof value === 'string' ? value.trim() : '';
}

function presetOf(spec: t.ConfigRecord): t.ConfigRecord {
  return isConfigRecord(spec.preset) ? spec.preset : {};
}

/**
 * The endpoint a spec uses, as LibreChat resolves it: the preset's endpoint,
 * or the agents endpoint when the preset names only an agent.
 */
export function specEndpoint(spec: t.ConfigValue): string {
  if (!isConfigRecord(spec)) return '';
  const preset = presetOf(spec);
  const endpoint = textOf(preset.endpoint);
  if (endpoint) return endpoint;
  return textOf(preset.agent_id) ? EModelEndpoint.agents : '';
}

/** Whether a spec runs an agent (the agents endpoint picks its model from the agent). */
export function isAgentSpec(spec: t.ConfigValue): boolean {
  return specEndpoint(spec) === EModelEndpoint.agents;
}

function requiredProblems(spec: t.ConfigRecord, index: number): t.SpecProblem[] {
  const preset = presetOf(spec);
  const problems: t.SpecProblem[] = [];
  const required = (field: string) =>
    problems.push({ index, field, code: 'required', level: 'error' });
  if (!textOf(spec.name)) required('name');
  if (!textOf(spec.label)) required('label');
  const endpoint = specEndpoint(spec);
  if (!endpoint) required('preset.endpoint');
  if (endpoint === EModelEndpoint.agents) {
    if (!textOf(preset.agent_id)) required('preset.agent_id');
  } else if (!textOf(preset.model)) {
    required('preset.model');
  }
  return problems;
}

/** One problem for each spec after the first that repeats a value the list allows once. */
function repeatProblems(
  items: t.ConfigValue[],
  valueOf: (spec: t.ConfigRecord) => string | null,
  field: string,
  code: string,
): t.SpecProblem[] {
  const first = new Map<string, number>();
  const problems: t.SpecProblem[] = [];
  items.forEach((spec, index) => {
    if (!isConfigRecord(spec)) return;
    const value = valueOf(spec);
    if (value === null) return;
    const owner = first.get(value);
    if (owner === undefined) {
      first.set(value, index);
      return;
    }
    const ownerSpec = items[owner];
    const name = isConfigRecord(ownerSpec) ? textOf(ownerSpec.label) || textOf(ownerSpec.name) : '';
    problems.push({ index, field, code, level: 'error', params: { name, position: owner + 1 } });
  });
  return problems;
}

function unknownEndpointProblem(
  spec: t.ConfigRecord,
  index: number,
  known: ReadonlySet<string>,
): t.SpecProblem[] {
  const endpoint = textOf(presetOf(spec).endpoint);
  if (!endpoint || known.size === 0 || known.has(endpoint)) return [];
  return [
    {
      index,
      field: 'preset.endpoint',
      code: 'spec_unknown_endpoint',
      level: 'warning',
      params: { endpoint },
    },
  ];
}

/**
 * Semantic checks of a spec list (MS-2) that the schema can't express: a
 * name, label, endpoint and model (or agent) on every spec, unique names (the
 * id conversations and `?spec=` links use), at most one default and one soft
 * default, and a warning for an endpoint the configuration doesn't define.
 */
export function validateSpecs(
  items: t.ConfigValue[],
  ctx: t.SpecValidationContext,
): t.SpecProblem[] {
  const perSpec = items.flatMap((spec, index) =>
    isConfigRecord(spec)
      ? [
          ...requiredProblems(spec, index),
          ...unknownEndpointProblem(spec, index, ctx.knownEndpoints),
        ]
      : [],
  );
  return [
    ...perSpec,
    ...repeatProblems(items, (spec) => textOf(spec.name) || null, 'name', 'spec_duplicate_name'),
    ...repeatProblems(
      items,
      (spec) => (spec.default === true ? 'default' : null),
      'default',
      'spec_multiple_default',
    ),
    ...repeatProblems(
      items,
      (spec) => (spec.softDefault === true ? 'soft' : null),
      'softDefault',
      'spec_multiple_soft_default',
    ),
  ];
}

/** Problems of one spec, errors first. */
export function problemsOf(problems: t.SpecProblem[], index: number): t.SpecProblem[] {
  return problems
    .filter((problem) => problem.index === index)
    .sort((a, b) => Number(a.level === 'warning') - Number(b.level === 'warning'));
}

/** The first problem of a spec field. */
export function problemAt(
  problems: t.SpecProblem[],
  index: number,
  field: string,
): t.SpecProblem | undefined {
  return problemsOf(problems, index).find((problem) => problem.field === field);
}

/**
 * Save-blocking issues of a pending spec list, for the save pipeline (WS1):
 * the errors of `validateSpecs`, at the spec's position in the pending list.
 * A missing or repeated name is left out (the pipeline itself reports an
 * entry without its key, and a new or renamed entry taking a used name), and
 * an entry is named by its name when that is unique.
 */
export function specListIssues(changeSet: t.ConfigChangeSet): t.ConfigIssue[] {
  const pending = changeSet.collections.find(
    (collection) => collection.collection.path === SPEC_LIST_PATH,
  );
  if (!pending || !getKeyedCollection(SPEC_LIST_PATH)) return [];
  const { items } = pending;
  const names = new Map<string, number>();
  for (const item of items) {
    const name = isConfigRecord(item) ? textOf(item.name) : '';
    if (name) names.set(name, (names.get(name) ?? 0) + 1);
  }
  return validateSpecs(items, { knownEndpoints: new Set() })
    .filter((problem) => problem.level === 'error')
    .filter((problem) => problem.field !== 'name')
    .map((problem): t.ConfigIssue => {
      const spec = items[problem.index];
      const name = isConfigRecord(spec) ? textOf(spec.name) : '';
      const unique = name !== '' && names.get(name) === 1;
      return {
        path: `${SPEC_LIST_PATH}.${problem.index}.${problem.field}`,
        code: problem.code,
        message: ISSUE_TEXT[problem.code] ?? problem.code,
        params: problem.params,
        ...(unique && { entryIdentity: name, entryPath: problem.field }),
      };
    });
}
