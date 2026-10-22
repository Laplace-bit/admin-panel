import { useContext, useState } from 'react';
import { Button } from '@clickhouse/click-ui';
import type * as t from '@/types';
import {
  WEB_SEARCH_SERVICES,
  WEB_SEARCH_SELECTORS,
  WEB_SEARCH_ROLE_KEYS,
  WEB_SEARCH_GENERAL_KEYS,
} from '@/constants';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { UnknownSettings } from '../../UnknownSettings';
import { CredentialControl } from './Credential';
import { countConfigured, hasPendingValue } from '../../counts';
import { NestedGroup } from '../../renderer';
import { FeatureFields } from './Fields';
import { isRowVisible } from '@/utils';
import { useLocalize } from '@/hooks';

const CATEGORIES: readonly t.WebSearchCategory[] = ['providers', 'scrapers', 'rerankers'];

/** Adds a service to a list of views, merging the roles, credentials and options of one already there. */
function addService(
  views: t.WebSearchServiceView[],
  service: t.WebSearchService,
  role?: t.WebSearchCategory,
): t.WebSearchServiceView[] {
  const existing = views.find((view) => view.value === service.value);
  if (!existing) {
    return [...views, { ...service, roles: role ? [role] : [] }];
  }
  const keys = new Set(existing.credentials.map((credential) => credential.key));
  const merged: t.WebSearchServiceView = {
    ...existing,
    roles: role && !existing.roles.includes(role) ? [...existing.roles, role] : existing.roles,
    credentials: [
      ...existing.credentials,
      ...service.credentials.filter((credential) => !keys.has(credential.key)),
    ],
    optionKeys: [...new Set([...existing.optionKeys, ...service.optionKeys])],
  };
  return views.map((view) => (view === existing ? merged : view));
}

/**
 * The services selected for search, scraping and reranking, one view per
 * service. A service in use also lists the settings of its roles not
 * selected (Tavily's extract URL and scraper options while it only
 * searches): "Show other services" leaves it out, so they would be nowhere
 * else.
 */
export function selectedServices(
  selected: Readonly<Partial<Record<t.WebSearchCategory, string>>>,
): t.WebSearchServiceView[] {
  const views = CATEGORIES.reduce<t.WebSearchServiceView[]>((acc, category) => {
    const service = WEB_SEARCH_SERVICES[category].find((s) => s.value === selected[category]);
    return service ? addService(acc, service, category) : acc;
  }, []);
  const used = new Set(views.map((view) => view.value));
  return CATEGORIES.reduce(
    (acc, category) =>
      WEB_SEARCH_SERVICES[category]
        .filter((service) => used.has(service.value) && service.value !== selected[category])
        .reduce((merged, service) => addService(merged, service), acc),
    views,
  );
}

/** Every other service, for "Show all services". */
export function otherServices(inUse: readonly t.WebSearchServiceView[]): t.WebSearchServiceView[] {
  const used = new Set(inUse.map((view) => view.value));
  return CATEGORIES.reduce<t.WebSearchServiceView[]>(
    (views, category) =>
      WEB_SEARCH_SERVICES[category]
        .filter((service) => !used.has(service.value))
        .reduce((acc, service) => addService(acc, service), views),
    [],
  );
}

/** One service: its credentials with their status, then its options. */
function ServiceGroup({ service, ...props }: t.WebSearchServiceProps) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const { fields, parentPath } = props;
  const name = localize(service.labelKey);
  const inUse = service.roles.length > 0;
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const credentialFields = service.credentials.flatMap((c) => byKey.get(c.key) ?? []);
  const optionFields = service.optionKeys.flatMap((key) => byKey.get(key) ?? []);
  const controls: t.FeatureControls = Object.fromEntries(
    service.credentials.map((credential) => [
      credential.key,
      (control: t.FieldControlProps) => (
        <CredentialControl {...control} credential={credential} serviceName={name} inUse={inUse} />
      ),
    ]),
  );
  const shown = [...credentialFields, ...optionFields];
  const counts = countConfigured(shown, parentPath, props.configuredPaths);
  const paths = shown.map((field) => `${parentPath}.${field.key}`);
  const hiddenByFilter = !paths.some((path) => isRowVisible(rowFilter, path));
  const hiddenByConfigured =
    props.showConfiguredOnly &&
    !props.previewMode &&
    counts.configured === 0 &&
    !paths.some((path) => hasPendingValue(path, props.editedValues));
  if (shown.length === 0 || hiddenByFilter || hiddenByConfigured) return null;
  const label = inUse
    ? localize('com_config_features_ws_service_roles', {
        name,
        roles: service.roles.map((role) => localize(WEB_SEARCH_ROLE_KEYS[role])).join(', '),
      })
    : name;
  return (
    <NestedGroup
      label={label}
      sectionId={`section-${parentPath}-service-${service.value}`}
      configuredCount={counts.configured}
      totalCount={counts.total}
      defaultExpanded={inUse}
      disabled={props.disabled}
      revealPaths={paths}
    >
      <FeatureFields {...props} fields={credentialFields} controls={controls} />
      {optionFields.length > 0 && <FeatureFields {...props} fields={optionFields} />}
    </NestedGroup>
  );
}

/**
 * Web search (FX-2): the search provider, scraper and reranker first, then
 * one group per selected service with only the credentials and options it
 * uses (a service selected twice, such as Tavily for search and scraping, is
 * shown once). Each credential says where its value comes from. Services not
 * selected stay behind "Show all services"; settings no service lists (a
 * newer schema) follow at the end.
 */
export function WebSearchRenderer(props: t.FieldRendererProps) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const [showAll, setShowAll] = useState(false);
  const { fields, parentPath, parentValue, getValue } = props;
  const selected: Partial<Record<t.WebSearchCategory, string>> = {};
  for (const category of CATEGORIES) {
    const value = getValue(`${parentPath}.${WEB_SEARCH_SELECTORS[category]}`, undefined);
    if (typeof value === 'string') selected[category] = value;
  }
  const inUse = selectedServices(selected);
  const others = otherServices(inUse);
  const automatic = CATEGORIES.filter((category) => selected[category] === undefined);
  const general = new Set(WEB_SEARCH_GENERAL_KEYS);
  const serviceKeys = new Set(
    Object.values(WEB_SEARCH_SERVICES).flatMap((services) =>
      services.flatMap((service) => [
        ...service.credentials.map((credential) => credential.key),
        ...service.optionKeys,
      ]),
    ),
  );
  const generalFields = fields.filter((field) => general.has(field.key));
  const remaining = fields.filter(
    (field) => !general.has(field.key) && !serviceKeys.has(field.key),
  );
  /** While the tab filter is on, every service that holds a match is shown. */
  const filteredOthers = rowFilter
    ? others.filter((service) =>
        [...service.credentials.map((c) => c.key), ...service.optionKeys].some((key) =>
          isRowVisible(rowFilter, `${parentPath}.${key}`),
        ),
      )
    : others;
  const showsOthers = showAll || (rowFilter != null && filteredOthers.length > 0);

  return (
    <>
      <FeatureFields {...props} fields={generalFields} />
      {automatic.length > 0 && !rowFilter && (
        <p className="m-0 pb-2 text-xs text-(--settings-muted-fg)">
          {localize('com_config_features_ws_automatic_note', {
            roles: automatic.map((role) => localize(WEB_SEARCH_ROLE_KEYS[role])).join(', '),
          })}
        </p>
      )}
      {inUse.map((service) => (
        <ServiceGroup key={service.value} {...props} service={service} />
      ))}
      {showsOthers &&
        filteredOthers.map((service) => (
          <ServiceGroup key={service.value} {...props} service={service} />
        ))}
      {!rowFilter && others.length > 0 && (
        <div className="self-start py-2">
          <Button
            htmlType="button"
            type="secondary"
            iconLeft={showAll ? 'chevron-up' : 'chevron-down'}
            label={localize(
              showAll ? 'com_config_features_ws_hide_others' : 'com_config_features_ws_show_all',
              { count: others.length },
            )}
            onClick={() => setShowAll((open) => !open)}
          />
        </div>
      )}
      {remaining.length > 0 && <FeatureFields {...props} fields={remaining} />}
      {!rowFilter && <UnknownSettings fields={fields} value={parentValue} path={parentPath} />}
    </>
  );
}
