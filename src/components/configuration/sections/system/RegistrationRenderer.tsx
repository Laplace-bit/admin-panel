import { useContext, useState } from 'react';
import type * as t from '@/types';
import { isConfigRecord, getValueAtPath, isConfigValueEqual } from '@/utils';
import { NestedGroup, FieldRenderer, toFieldId } from '../../renderer';
import { useLocalize, useOwnedField, useYamlConfig } from '@/hooks';
import { ConfirmChoiceDialog } from '../../fields/ConfirmChoice';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { countConfigured, hasPathOverlap } from '../../counts';
import { FieldRow, isRowShown } from '../files/FieldRow';
import { UnknownSettings } from '../../UnknownSettings';
import { ReadOnlySection } from '../../ReadOnlySection';
import { SOCIAL_LOGIN_PROVIDERS } from '@/constants';
import { DomainListField } from './DomainListField';
import { SettingsRow } from '../../SettingsRow';
import { ConfigRow } from '../../ConfigRow';
import { labelForPath } from '../../meta';

const SECTION = 'registration';
const NO_PATHS: ReadonlySet<string> = new Set();
const SOCIAL = 'registration.socialLogins';
const DOMAINS = 'registration.allowedDomains';
const CUSTOM_ROWS: ReadonlySet<string> = new Set(['socialLogins', 'allowedDomains']);
/** Set up once at startup from librechat.yaml (`configureSocialLogins`): shown read-only. */
const STARTUP_KEYS: ReadonlySet<string> = new Set(['oauthStateTtlMs', 'openidDiscovery']);

function stringList(value: t.ConfigValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Social sign-in buttons (FX-9, FX-10): the sign-in page reads them from
 * librechat.yaml only (else LibreChat's default list), so they are shown
 * read-only by provider name from there, never from an override (in a
 * profile, Base's), with a way to remove an override saved before (it never
 * took effect).
 */
function SocialLoginsRow({ fieldProps }: { fieldProps: t.FieldRendererProps }) {
  const localize = useLocalize();
  const yaml = useYamlConfig();
  const rowFilter = useContext(RowFilterContext);
  const social = useOwnedField(SOCIAL, fieldProps);
  if (!isRowShown(rowFilter, SOCIAL, fieldProps)) return null;
  const providers = stringList(getValueAtPath(yaml, SOCIAL) ?? fieldProps.schemaDefaults?.[SOCIAL]);
  const hasStaleOverride = social.state.isOverride;
  const canRemove =
    hasStaleOverride &&
    !social.state.isPendingReset &&
    !fieldProps.disabled &&
    fieldProps.onResetField;
  const id = toFieldId(SOCIAL);
  return (
    <SettingsRow
      label={labelForPath(SOCIAL, localize)}
      htmlFor={id}
      description={localize('com_config_registration_social_desc')}
      control={
        <div className="flex flex-col gap-2">
          {providers.length > 0 ? (
            <ul id={id} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {providers.map((provider) => {
                const labelKey = SOCIAL_LOGIN_PROVIDERS[provider];
                return (
                  <li
                    key={provider}
                    className="rounded-md border border-(--cui-color-stroke-default) bg-(--cui-color-background-muted) px-2 py-0.5 text-sm text-(--cui-color-text-default)"
                  >
                    {labelKey
                      ? localize(labelKey)
                      : localize('com_config_registration_provider_unknown', { name: provider })}
                  </li>
                );
              })}
            </ul>
          ) : (
            <span id={id} className="static-value">
              {localize('com_config_registration_social_none')}
            </span>
          )}
          <span className="flex items-start gap-1.5 text-xs text-(--cui-color-text-muted)">
            {localize('com_config_registration_social_yaml')}
          </span>
          {hasStaleOverride && (
            <span role="status" className="flex flex-wrap items-center gap-2 text-xs">
              {localize(
                social.state.isPendingReset
                  ? 'com_config_stale_override_pending'
                  : 'com_config_stale_override',
              )}
              {canRemove && (
                <button
                  type="button"
                  className="settings-row-action"
                  onClick={() => fieldProps.onResetField?.(SOCIAL)}
                >
                  {localize('com_config_remove_stale_override')}
                </button>
              )}
            </span>
          )}
        </div>
      }
    />
  );
}

/**
 * Allowed sign-up domains as validated chips (FX-9). An empty list lets
 * anyone sign up, so emptying a restricted list asks first.
 */
function AllowedDomainsRow({ fieldProps }: { fieldProps: t.FieldRendererProps }) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const yaml = useYamlConfig();
  const field = useOwnedField(DOMAINS, fieldProps);
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (!isRowShown(rowFilter, DOMAINS, fieldProps)) return null;
  const id = toFieldId(DOMAINS);
  const domains = stringList(field.state.value);
  const lower = stringList(field.fallback);
  const yamlDomains = stringList(getValueAtPath(yaml, DOMAINS));
  const differsFromYaml = yamlDomains.length > 0 && !isConfigValueEqual(domains, yamlDomains);

  /** Back to the list beneath when it matches, else the target's own list (an empty one only after asking). */
  const change = (next: string[]) => {
    if (next.length === 0 && domains.length > 0) {
      setConfirmOpen(true);
      return;
    }
    if (isConfigValueEqual(next, lower) && field.own !== undefined) {
      field.set(undefined);
      return;
    }
    field.set(next);
  };

  const openSignUp = () => {
    setConfirmOpen(false);
    if (lower.length > 0) field.set([]);
    else field.set(undefined);
  };

  const label = labelForPath(DOMAINS, localize);
  return (
    <>
      <ConfigRow
        title={label}
        description={localize('com_config_registration_domains_desc')}
        fieldId={`${id}-input`}
        fieldPath={DOMAINS}
        disabled={fieldProps.disabled}
        permissions={fieldProps.permissions}
        previewScope={fieldProps.previewScope}
        previewChangedPaths={fieldProps.previewChangedPaths}
        onResetField={fieldProps.onResetField}
        onDiscardField={fieldProps.onDiscardField}
        isConfigured={fieldProps.configuredPaths?.has(DOMAINS) ?? false}
        isDbOverride={fieldProps.dbOverridePaths?.has(DOMAINS) ?? false}
        isPendingReset={fieldProps.pendingResets?.has(DOMAINS) ?? false}
      >
        <div className="flex w-full flex-col gap-2">
          {!fieldProps.disabled && (
            <span
              id={`${id}-status`}
              role="status"
              className={
                domains.length === 0
                  ? 'text-xs font-medium text-(--settings-warn-fg)'
                  : 'text-xs text-(--cui-color-text-muted)'
              }
            >
              {domains.length === 0
                ? localize('com_config_registration_anyone')
                : localize('com_config_registration_restricted', { count: domains.length })}
            </span>
          )}
          <DomainListField
            id={id}
            domains={domains}
            onChange={change}
            disabled={fieldProps.disabled}
            aria-label={label}
            aria-describedby={fieldProps.disabled ? undefined : `${id}-status`}
          />
          {differsFromYaml && (
            <span className="text-xs text-(--cui-color-text-muted)">
              {localize('com_config_registration_domains_yaml_note')}
            </span>
          )}
        </div>
      </ConfigRow>
      {confirmOpen && (
        <ConfirmChoiceDialog
          open
          title={localize('com_config_registration_open_title')}
          onCancel={() => setConfirmOpen(false)}
          actions={[
            {
              label: localize('com_config_registration_open_confirm'),
              type: 'danger',
              onSelect: openSignUp,
            },
          ]}
        >
          <p className="m-0">{localize('com_config_registration_open_body')}</p>
        </ConfirmChoiceDialog>
      )}
    </>
  );
}

/**
 * The sign-in settings LibreChat reads once at startup from librechat.yaml
 * (FX-10): shown read-only under one note, which offers to remove overrides
 * saved before (they never took effect).
 */
function StartupSettings({
  fields,
  fieldProps,
}: {
  fields: t.SchemaField[];
  fieldProps: t.FieldRendererProps;
}) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const paths = fields.map((field) => `${SECTION}.${field.key}`);
  if (fields.length === 0 || !paths.some((path) => isRowShown(rowFilter, path, fieldProps))) {
    return null;
  }
  const overrides = fieldProps.dbOverridePaths ?? NO_PATHS;
  const pending = fieldProps.pendingResets ?? NO_PATHS;
  const stale = paths.filter((path) => hasPathOverlap(path, overrides) && !pending.has(path));
  const canRemove = stale.length > 0 && !fieldProps.disabled && fieldProps.onResetField;
  return (
    <ReadOnlySection
      reason="yamlOnly"
      message={localize('com_config_registration_startup_yaml')}
      detail={
        canRemove ? (
          <button
            type="button"
            className="settings-row-action -ml-1.5"
            onClick={() => stale.forEach((path) => fieldProps.onResetField?.(path))}
          >
            {localize('com_config_remove_stale_override')}
          </button>
        ) : undefined
      }
    >
      {fields.map((field) => {
        const path = `${SECTION}.${field.key}`;
        if (!field.children?.length) {
          return (
            <FieldRow
              key={field.key}
              field={field}
              fieldProps={{ ...fieldProps, disabled: true }}
            />
          );
        }
        const value = getValueAtPath(fieldProps.parentValue ?? null, field.key);
        const counts = countConfigured(field.children, path, fieldProps.configuredPaths);
        return (
          <NestedGroup
            key={field.key}
            label={labelForPath(path, localize)}
            sectionId={`section-${path}`}
            configuredCount={counts.configured}
            totalCount={counts.total}
            disabled
            revealPaths={[path]}
          >
            <FieldRenderer
              {...fieldProps}
              fields={field.children}
              parentValue={isConfigRecord(value) ? value : {}}
              parentPath={path}
              disabled
            />
          </NestedGroup>
        );
      })}
    </ReadOnlySection>
  );
}

/**
 * Registration (FX-9, FX-10): social sign-in providers (read only from
 * librechat.yaml), allowed sign-up domains as chips, any other setting as a
 * generic row, and the startup-only sign-in settings read-only.
 */
export function RegistrationRenderer(props: t.FieldRendererProps) {
  const rowFilter = useContext(RowFilterContext);
  const keys = new Set(props.fields.map((field) => field.key));
  const startup = props.fields.filter((field) => STARTUP_KEYS.has(field.key));
  const others = props.fields.filter(
    (field) => !CUSTOM_ROWS.has(field.key) && !STARTUP_KEYS.has(field.key),
  );
  return (
    <>
      {keys.has('socialLogins') && <SocialLoginsRow fieldProps={props} />}
      {keys.has('allowedDomains') && <AllowedDomainsRow fieldProps={props} />}
      {others.length > 0 && <FieldRenderer {...props} fields={others} />}
      <StartupSettings fields={startup} fieldProps={props} />
      {!rowFilter && (
        <UnknownSettings fields={props.fields} value={props.parentValue} path={SECTION} />
      )}
    </>
  );
}
