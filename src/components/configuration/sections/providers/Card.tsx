import { useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  formatSummary,
  summarizeFields,
  createSummaryReader,
  resolveProviderGroups,
} from './layout';
import { useLocalize, useGlobalTitleBlock, usePersistentExpanded } from '@/hooks';
import { getValueAtPath, isConfigRecord, getUnknownConfigEntries } from '@/utils';
import { GLOBAL_PROVIDER_KEY, DEFAULT_RECURSION_LIMIT } from '@/constants';
import { ProviderStatusBadge, ProviderStatusRow } from './ProviderStatus';
import { isPathSet, countConfigured, hasPathOverlap } from '../../counts';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { ProviderGroup, PROVIDERS_STORAGE_KEY } from './Group';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { UnknownSettings } from '../../UnknownSettings';
import { SettingsSection } from '../../SettingsSection';
import { GlobalTitlesNotice } from './GlobalNotice';
import { AzureGroupsTable } from './AzureGroups';
import { StaleOverride } from './StaleOverride';
import { InfoBanner } from '../../InfoBanner';
import { labelForPath } from '../../meta';
import { SetBadge } from './SetBadge';

const NO_PATHS: ReadonlySet<string> = new Set();
const AZURE_TABLE_KEYS: ReadonlySet<string> = new Set(['groups']);
const VERTEX_KEYS: ReadonlySet<string> = new Set(['vertex']);

/** A number setting's value, or undefined when unset or not a number. */
function numberAt(value: t.ConfigValue): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * One provider of the AI providers tab (AP-4): an h2 card whose header names
 * the provider with its Active / Not enabled status (AP-5), how many settings
 * are customized (AP-10) and, collapsed, what they are. Its body starts with
 * the status and credentials row, then the purpose groups. Open state is
 * remembered per tab (AP-8). The Global block explains that it applies to
 * every endpoint (AP-3).
 */
export function ProviderCard({ field, parentPath, parentValue, ...rest }: t.ProviderCardProps) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const values = useContext(ConfigValuesContext);
  const hasGlobal = useGlobalTitleBlock();
  const { getValue, configuredPaths, dbOverridePaths, editedValues, onResetField, disabled } = rest;
  const path = `${parentPath}.${field.key}`;
  const isGlobal = field.key === GLOBAL_PROVIDER_KEY;
  const children = useMemo(() => field.children ?? [], [field.children]);
  const { groups } = useMemo(
    () => resolveProviderGroups(field.key, children),
    [field.key, children],
  );
  const { isExpanded, hasEverExpanded, sectionRef, toggle } = usePersistentExpanded({
    storageKey: PROVIDERS_STORAGE_KEY,
    id: field.key,
    revealPaths: [path],
  });

  const parentRecord = isConfigRecord(parentValue) ? parentValue : {};
  const providerValue = getValue(path, parentRecord[field.key]);
  const { configured } = countConfigured(children, path, configuredPaths);
  const overrides = dbOverridePaths
    ? countConfigured(children, path, dbOverridePaths, true).configured
    : 0;
  const summary = isExpanded
    ? undefined
    : formatSummary(
        summarizeFields(
          groups.filter((group) => !group.def.unused).flatMap((group) => group.fields),
          path,
          createSummaryReader({
            providerPath: path,
            providerValue,
            getValue,
            configuredPaths,
            editedValues,
            root: values?.configValues ?? null,
          }),
          localize,
        ),
        localize,
      );

  const description: ReactNode = isGlobal ? (
    <>
      {localize('com_config_providers_global_desc')}
      {summary && (
        <span className="provider-card-summary">
          {localize('com_config_providers_summary_set', { summary })}
        </span>
      )}
    </>
  ) : (
    summary
  );

  const groupContent = (group: t.ProviderGroup): Partial<t.ProviderGroupSectionProps> => {
    const key = group.def.key;
    if (key === 'titles' && hasGlobal && !isGlobal) {
      return {
        notice: <GlobalTitlesNotice />,
        summaryOverride: localize('com_config_providers_summary_ignored'),
      };
    }
    const groupSet = group.fields.some((child) =>
      isPathSet(`${path}.${child.key}`, configuredPaths, editedValues),
    );
    if (key === 'titles' && isGlobal && !groupSet) {
      return { summaryOverride: localize('com_config_providers_summary_global_titles') };
    }
    if (key === 'groups' && field.key === 'azureOpenAI') {
      const groupsPath = `${path}.groups`;
      const groupsValue = getValue(groupsPath, getValueAtPath(providerValue, 'groups'));
      const groupCount = Array.isArray(groupsValue) ? groupsValue.length : 0;
      return {
        hiddenKeys: AZURE_TABLE_KEYS,
        countBadge:
          groupCount > 0 ? (
            <span className="config-count-badge config-count-badge-active">
              <span className="sr-only">, </span>
              {localize('com_config_providers_groups', { count: groupCount })}
            </span>
          ) : undefined,
        before: (
          <div className="flex flex-col gap-3">
            <InfoBanner
              text={localize('com_config_providers_azure_readonly')}
              dismissible={false}
            />
            {hasPathOverlap(groupsPath, dbOverridePaths ?? NO_PATHS) && (
              <StaleOverride
                pendingRemoval={rest.pendingResets?.has(groupsPath) ?? false}
                onRemove={disabled || !onResetField ? undefined : () => onResetField(groupsPath)}
              />
            )}
            <AzureGroupsTable
              path={groupsPath}
              value={groupsValue}
              field={children.find((child) => child.key === 'groups')}
            />
          </div>
        ),
      };
    }
    if (key === 'models' && field.key === 'anthropic') {
      const vertexPath = `${path}.vertex`;
      const vertexSet = isConfigRecord(
        getValue(vertexPath, getValueAtPath(providerValue, 'vertex')),
      );
      if (vertexSet) return {};
      return {
        hiddenKeys: VERTEX_KEYS,
        after: (
          <p className="settings-help m-0 py-2">{localize('com_config_providers_vertex_none')}</p>
        ),
      };
    }
    if (key === 'features' && field.key === 'agents') {
      const limit =
        numberAt(getValue(`${path}.recursionLimit`, undefined)) ?? DEFAULT_RECURSION_LIMIT;
      const max = numberAt(getValue(`${path}.maxRecursionLimit`, undefined));
      if (max === undefined || max < 1 || max >= limit) return {};
      return {
        after: (
          <p role="note" className="m-0 py-2 text-xs text-(--settings-warn-fg)">
            {localize('com_config_providers_recursion_capped', { max, limit })}
          </p>
        ),
      };
    }
    if (
      key === 'advanced' &&
      !rowFilter &&
      getUnknownConfigEntries(children, providerValue).length
    ) {
      return { after: <UnknownSettings fields={children} value={providerValue} path={path} /> };
    }
    return {};
  };

  return (
    <SettingsSection
      id={`section-${path}`}
      sectionRef={sectionRef}
      title={labelForPath(path, localize)}
      description={description}
      level={2}
      badge={
        <>
          {!isGlobal && <ProviderStatusBadge provider={field.key} />}
          <SetBadge count={configured} overrides={overrides} />
        </>
      }
      expanded={isExpanded}
      onToggle={toggle}
      hasEverExpanded={hasEverExpanded}
      sticky
    >
      {!isGlobal && !rowFilter && <ProviderStatusRow provider={field.key} />}
      <div className="provider-groups">
        {groups.map((group) => (
          <ProviderGroup
            key={group.def.key}
            group={group}
            providerPath={path}
            providerValue={providerValue}
            stateId={`${field.key}.${group.def.key}`}
            {...rest}
            {...groupContent(group)}
          />
        ))}
      </div>
    </SettingsSection>
  );
}
