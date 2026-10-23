import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  ENDPOINT_SECTIONS,
  PLACED_TOP_KEYS,
  sectionOfField,
  HIDDEN_ENDPOINT_KEYS,
  MODEL_REFERENCE_KEYS,
  ESSENTIAL_SECTION_IDS,
  ENDPOINT_REFERENCE_KEYS,
} from './groups';
import {
  NameRow,
  ParamSetRow,
  ModelRefRow,
  HiddenKeyRow,
  DropParamsRow,
  EndpointRefRow,
} from './Fields';
import { ConfigErrorsProvider, ConfigErrorsContext } from '@/contexts/ConfigErrorsContext';
import { EntryFieldChipsContext } from '@/contexts/EntryFieldChipsContext';
import { getEntryKey, getValueAtPath, isConfigRecord } from '@/utils';
import { renderInlineField, toFieldId } from '../../renderer';
import { ParamDefinitionsRow } from './ParamDefinitions';
import { UnknownSettings } from '../../UnknownSettings';
import { HeaderPlaceholders } from './Request';
import { SelectField } from '../../fields';
import { labelForPath } from '../../meta';
import { describeIssue } from './issues';
import { PricingRow } from './Pricing';
import { useLocalize } from '@/hooks';
import { FieldChips } from './Chips';
import { modelNames } from './model';
import { Banner } from './Banner';

/** Fields an endpoint added in the panel can't be served without (CE-3). */
const REQUIRED_KEYS: ReadonlySet<string> = new Set(['name', 'apiKey', 'baseURL', 'models.default']);

/** Required fields whose control says itself that it is empty (the model list). */
const SELF_REPORTED: ReadonlySet<t.EndpointIssueCode> = new Set(['modelsRequired']);

/** For each model picker, the endpoint settings that say whose models it names. */
const MODEL_ENDPOINT_KEYS: Readonly<Record<string, string[]>> = {
  titleModel: ['titleEndpoint'],
  activityModel: ['activityEndpoint', 'titleEndpoint'],
  activityPhaseModel: ['activityPhaseEndpoint', 'activityEndpoint', 'titleEndpoint'],
  reasoningLabelModel: ['reasoningLabelEndpoint', 'activityEndpoint', 'titleEndpoint'],
};

function asRecord(value: t.ConfigValue): t.ConfigRecord {
  return isConfigRecord(value) ? value : {};
}

function hasValue(value: t.ConfigValue): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isConfigRecord(value)) return Object.keys(value).length > 0;
  return true;
}

interface ResolvedField {
  key: string;
  field: t.SchemaField;
  parentKey?: string;
}

interface SectionLayout {
  section: t.EndpointSectionDef;
  visible: t.EndpointFieldDef[];
  hidden: t.EndpointFieldDef[];
  warnings: string[];
}

/** Schema fields by entry key, nested ones as `models.default`. */
function indexFields(fields: t.SchemaField[]): Map<string, ResolvedField> {
  const index = new Map<string, ResolvedField>();
  for (const field of fields) {
    index.set(field.key, { key: field.key, field });
    const isGroup = field.children?.length && !field.isArray && field.type !== 'record';
    if (!isGroup) continue;
    for (const child of field.children ?? []) {
      const key = `${field.key}.${child.key}`;
      index.set(key, { key, field: child, parentKey: field.key });
    }
  }
  return index;
}

/** Schema keys no section places (newer LibreChat settings), for "Other settings". */
function unplacedKeys(index: Map<string, ResolvedField>): t.EndpointFieldDef[] {
  const placed = new Set(ENDPOINT_SECTIONS.flatMap((section) => section.fields.map((f) => f.key)));
  const parents = new Set([...index.values()].flatMap((entry) => entry.parentKey ?? []));
  const defs: t.EndpointFieldDef[] = [];
  for (const [key, resolved] of index) {
    if (placed.has(key) || HIDDEN_ENDPOINT_KEYS.has(key) || parents.has(key)) continue;
    const top = resolved.parentKey ?? key;
    if (resolved.parentKey === undefined && PLACED_TOP_KEYS.has(key)) continue;
    if (resolved.parentKey !== undefined && !PLACED_TOP_KEYS.has(top)) continue;
    defs.push({ key, optional: true });
  }
  return defs;
}

/** The endpoint a model setting names models of: the first endpoint setting that is set, else this one. */
function modelEndpoint(key: string, entry: t.ConfigRecord, own: string): string {
  for (const endpointKey of MODEL_ENDPOINT_KEYS[key] ?? []) {
    const named = entry[endpointKey];
    if (typeof named === 'string' && named !== '') return named;
  }
  return own;
}

/** Keys of the parameter definitions an endpoint defines. */
function definitionKeys(entry: t.ConfigRecord | undefined): ReadonlySet<string> {
  const list = asRecord(entry?.customParams).paramDefinitions;
  if (!Array.isArray(list)) return new Set();
  return new Set(list.flatMap((item) => getEntryKey(item, 'key') ?? []));
}

/** The parameter set users of the endpoint get: `defaultParamsEndpoint`, else its native provider's. */
function paramSetOf(entry: t.ConfigRecord): string {
  const chosen = asRecord(entry.customParams).defaultParamsEndpoint;
  if (typeof chosen === 'string' && chosen !== '' && chosen !== 'custom') return chosen;
  return typeof entry.provider === 'string' ? entry.provider : 'custom';
}

/**
 * The custom endpoint editor (WS10 CE-7): Connection, Models, Request
 * shaping, Behaviour, Labels & reasoning, Parameters and Token pricing.
 * Optional settings show only when set or added from "Add setting". Problems
 * show at their field (errors) or atop their section (warnings), and every
 * value the target overrides offers its revert (CE-2).
 */
export function EndpointEditor({
  path,
  fields,
  value,
  onFieldChange,
  issues,
  origin,
  disabled,
  endpointNames,
  storedSecret,
  lowerEntry,
  savedEntry,
  modelsOf,
  essentialsOnly,
  showChips,
  revealField,
  onRevealed,
  editSessionId,
}: t.EndpointEditorProps) {
  const localize = useLocalize();
  const pageErrors = useContext(ConfigErrorsContext);
  const index = useMemo(() => indexFields(fields), [fields]);
  const latestRef = useRef(value);
  latestRef.current = value;
  const onRevealedRef = useRef(onRevealed);
  onRevealedRef.current = onRevealed;
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const fromLower = origin === 'yaml' || origin === 'inherited';
  const name = typeof value.name === 'string' ? value.name : '';

  /** Inline errors: this editor's own wording first, the save pipeline's for anything else. */
  const errors = useMemo((): t.PathErrors => {
    const merged: t.PathErrors = { ...pageErrors };
    const own = new Set<string>();
    for (const issue of issues) {
      if (issue.severity !== 'error') continue;
      const issuePath = `${path}.${issue.field}`;
      if (!fromLower && SELF_REPORTED.has(issue.code)) {
        delete merged[issuePath];
        continue;
      }
      if (own.has(issuePath)) continue;
      own.add(issuePath);
      merged[issuePath] = describeIssue(issue, localize);
    }
    return merged;
  }, [issues, path, localize, pageErrors, fromLower]);

  const renderChips = useMemo((): t.EntryFieldChipsRenderer | null => {
    if (!showChips || disabled) return null;
    const prefix = `${path}.`;
    return (props) => (
      <FieldChips
        {...props}
        saved={getValueAtPath(savedEntry ?? null, props.path.slice(prefix.length))}
        showOverride={fromLower}
      />
    );
  }, [showChips, disabled, path, savedEntry, fromLower]);

  useEffect(() => {
    if (!revealField) return;
    const key = [...index.keys()].find(
      (candidate) => revealField === candidate || revealField.startsWith(`${candidate}.`),
    );
    if (key) setShown((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    const frame = requestAnimationFrame(() => onRevealedRef.current?.(`${path}.${revealField}`));
    return () => cancelAnimationFrame(frame);
  }, [revealField, index, path]);

  useEffect(() => {
    if (!focusKey) return;
    setFocusKey(null);
    requestAnimationFrame(() => {
      const target = document.getElementById(toFieldId(`${path}.${focusKey}`));
      const control = target?.matches('input, select, textarea, button')
        ? target
        : target?.querySelector<HTMLElement>('input, select, textarea, button');
      control?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      control?.focus({ preventScroll: true });
    });
  }, [focusKey, path]);

  const nestedChange =
    (parentKey: string) =>
    (childPath: string, childValue: t.ConfigValue): void => {
      const leaf = childPath.split('.').pop() ?? childPath;
      const next = { ...asRecord(latestRef.current[parentKey]), [leaf]: childValue };
      if (childValue === undefined) delete next[leaf];
      latestRef.current = { ...latestRef.current, [parentKey]: next };
      onFieldChange(parentKey, Object.keys(next).length > 0 ? next : undefined);
    };

  const topChange = (key: string, next: t.ConfigValue): void => {
    latestRef.current = { ...latestRef.current, [key]: next };
    onFieldChange(key, next);
  };

  const renderField = (key: string): ReactNode => {
    const resolved = index.get(key);
    if (!resolved) return null;
    const { field, parentKey } = resolved;
    const parentValue = parentKey ? asRecord(value[parentKey]) : value;
    const parentPath = parentKey ? `${path}.${parentKey}` : path;
    const change = parentKey ? nestedChange(parentKey) : topChange;
    const dataPath = `${parentPath}.${field.key}`;
    const current = parentValue[field.key];
    const write = (next: t.ConfigValue) => change(field.key, next);
    const chips =
      key === 'name' && fromLower
        ? undefined
        : (renderChips?.({
            path: dataPath,
            label: labelForPath(dataPath, localize),
            value: current,
            onChange: write,
          }) ?? undefined);
    const required = !fromLower && REQUIRED_KEYS.has(key);
    const common = { path: dataPath, field, value: current, chips, disabled, onChange: write };

    if (key === 'name') {
      const warning = issues.find(
        (issue) => issue.field === 'name' && issue.severity === 'warning',
      );
      return (
        <NameRow
          key={key}
          {...common}
          value={typeof current === 'string' ? current : ''}
          locked={fromLower}
          lockNote={localize(
            origin === 'inherited'
              ? 'com_config_ce_name_locked_inherited'
              : 'com_config_ce_name_locked',
          )}
          warning={warning ? describeIssue(warning, localize) : undefined}
          required={required}
        />
      );
    }
    if (key === 'apiKey' && fromLower && !storedSecret && lowerEntry?.apiKey === undefined) {
      return <HiddenKeyRow key={key} {...common} />;
    }
    if (ENDPOINT_REFERENCE_KEYS.has(key)) {
      const others = endpointNames.filter((other) => other !== name);
      return <EndpointRefRow key={key} {...common} names={others} />;
    }
    if (key === 'customParams.defaultParamsEndpoint') {
      return <ParamSetRow key={key} {...common} />;
    }
    if (key === 'customParams.paramDefinitions') {
      return (
        <ParamDefinitionsRow
          key={key}
          path={dataPath}
          field={field}
          value={current}
          lowerKeys={definitionKeys(lowerEntry)}
          paramSet={paramSetOf(value)}
          onChange={write}
          disabled={disabled}
          editSessionId={editSessionId}
          chips={chips}
        />
      );
    }
    if (MODEL_REFERENCE_KEYS.has(key)) {
      const endpoint = modelEndpoint(key, value, name);
      const models = endpoint === name ? modelNames(value) : (modelsOf?.(endpoint) ?? []);
      return <ModelRefRow key={key} {...common} endpointName={endpoint} models={models} />;
    }
    if (key === 'tokenConfig') {
      return (
        <PricingRow
          key={key}
          path={dataPath}
          value={current}
          models={modelNames(value)}
          lockedModels={new Set(Object.keys(asRecord(lowerEntry?.tokenConfig)))}
          onChange={write}
          disabled={disabled}
          chips={chips}
        />
      );
    }
    if (key === 'dropParams') {
      return <DropParamsRow key={key} {...common} />;
    }
    const shownField = required ? { ...field, isOptional: false } : field;
    if (key === 'headers' && !disabled) {
      return (
        <HeaderPlaceholders key={key}>
          {renderInlineField(shownField, parentValue, parentPath, change, localize, disabled)}
        </HeaderPlaceholders>
      );
    }
    return renderInlineField(
      shownField,
      parentValue,
      parentPath,
      change,
      localize,
      disabled,
      undefined,
      required,
      editSessionId,
    );
  };

  const isShown = (def: t.EndpointFieldDef): boolean => {
    if (!def.optional || shown.has(def.key)) return true;
    const [head, child] = def.key.split('.');
    return hasValue(child === undefined ? value[head] : asRecord(value[head])[child]);
  };

  const warnings = new Map<string, string[]>();
  for (const issue of issues) {
    if (issue.severity !== 'warning' || issue.field === 'name') continue;
    const section = sectionOfField(issue.field);
    warnings.set(section, [...(warnings.get(section) ?? []), describeIssue(issue, localize)]);
  }

  const layout: SectionLayout[] = ENDPOINT_SECTIONS.filter(
    (section) => !essentialsOnly || ESSENTIAL_SECTION_IDS.has(section.id),
  ).flatMap((section) => {
    const defs = (section.catchAll ? unplacedKeys(index) : section.fields).filter((def) =>
      index.has(def.key),
    );
    const visible = defs.filter(isShown);
    const hidden = disabled ? [] : defs.filter((def) => !isShown(def));
    if (visible.length === 0 && hidden.length === 0) return [];
    return [{ section, visible, hidden, warnings: warnings.get(section.id) ?? [] }];
  });

  const errorCount = (sectionId: string): number =>
    issues.filter(
      (issue) => issue.severity === 'error' && sectionOfField(issue.field) === sectionId,
    ).length;

  const sectionDomId = (id: string) => `${toFieldId(path)}-section-${id}`;

  return (
    <ConfigErrorsProvider value={errors}>
      <EntryFieldChipsContext.Provider value={renderChips}>
        <div className="flex flex-col gap-6">
          {!essentialsOnly && layout.length > 1 && (
            <nav
              aria-label={localize('com_config_ce_sections_nav')}
              className="sticky top-0 z-10 -mx-4 -mt-4 flex gap-1 overflow-x-auto border-b border-(--cui-color-stroke-default) bg-(--cui-color-background-panel) px-4 py-2"
            >
              {layout.map(({ section }) => {
                const count = errorCount(section.id);
                return (
                  <a
                    key={section.id}
                    href={`#${sectionDomId(section.id)}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document
                        .getElementById(sectionDomId(section.id))
                        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                    }}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap text-(--cui-color-text-muted) no-underline hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)"
                  >
                    {localize(section.labelKey)}
                    {count > 0 && (
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-(--settings-danger-bg) px-1 text-[0.6875rem] font-semibold text-(--settings-danger-fg)">
                        <span aria-hidden="true">{count}</span>
                        <span className="sr-only">
                          {localize('com_config_ce_section_errors', { count })}
                        </span>
                      </span>
                    )}
                  </a>
                );
              })}
            </nav>
          )}
          {layout.map(({ section, visible, hidden, warnings: sectionWarnings }) => {
            const headingId = `${sectionDomId(section.id)}-heading`;
            return (
              <section
                key={section.id}
                id={sectionDomId(section.id)}
                aria-labelledby={headingId}
                className="flex scroll-mt-14 flex-col gap-2"
              >
                <header className="flex flex-col gap-0.5 px-(--settings-row-px)">
                  <h3
                    id={headingId}
                    className="m-0 text-sm font-semibold text-(--cui-color-text-default)"
                  >
                    {localize(section.labelKey)}
                  </h3>
                  {section.descriptionKey && (
                    <p className="m-0 text-xs text-(--cui-color-text-muted)">
                      {localize(section.descriptionKey)}
                    </p>
                  )}
                </header>
                {sectionWarnings.map((warning) => (
                  <Banner key={warning} tone="warning" role="status">
                    {warning}
                  </Banner>
                ))}
                {visible.length > 0 ? (
                  <div className="flex flex-col">{visible.map((def) => renderField(def.key))}</div>
                ) : (
                  <p className="m-0 px-(--settings-row-px) text-sm text-(--cui-color-text-muted)">
                    {localize('com_config_ce_section_nothing_set')}
                  </p>
                )}
                {hidden.length > 0 && (
                  <div className="px-(--settings-row-px)">
                    <div className="w-64 max-w-full">
                      <SelectField
                        id={`${sectionDomId(section.id)}-add`}
                        value={undefined}
                        options={hidden.map((def) => ({
                          value: def.key,
                          label: labelForPath(`${path}.${def.key}`, localize),
                        }))}
                        placeholder={localize('com_config_ce_add_setting')}
                        onChange={(key) => {
                          setShown((prev) => new Set(prev).add(key));
                          setFocusKey(key);
                        }}
                        aria-label={localize('com_config_ce_add_setting_a11y', {
                          section: localize(section.labelKey),
                        })}
                      />
                    </div>
                  </div>
                )}
              </section>
            );
          })}
          {!essentialsOnly && <UnknownSettings fields={fields} value={value} path={path} />}
        </div>
      </EntryFieldChipsContext.Provider>
    </ConfigErrorsProvider>
  );
}
