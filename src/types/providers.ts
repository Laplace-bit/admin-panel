import type { ReactNode, RefObject } from 'react';
import type { ConfigValue, FlatConfigMap, SchemaField, SelectOption } from './config';
import type { ShadowedBy } from './values';
import type { FieldRendererProps } from './config-ui';

/** One endpoint LibreChat serves to the signed-in admin (`GET /api/endpoints`). */
export interface EndpointStatus {
  /** Endpoint key: a built-in provider (`openAI`) or a custom endpoint name. */
  name: string;
  /** Custom endpoints carry `type: 'custom'`; built-in providers have none. */
  custom: boolean;
  /** Users enter their own API key (or URL) in the chat instead of the server's. */
  userProvide: boolean;
  /** Display label LibreChat uses for a custom endpoint (`modelDisplayLabel`). */
  label?: string;
}

/** The enabled endpoints, keyed by name; endpoints LibreChat leaves out are not enabled. */
export type EndpointStatusMap = Record<string, EndpointStatus>;

/** Model names per endpoint (`GET /api/models`). */
export type EndpointModelsMap = Record<string, string[]>;

/** A tool agents can use (`GET /api/agents/tools`), as a select option. */
export interface ToolOption extends SelectOption {
  description?: string;
}

/** Runtime status of a provider: served by LibreChat, or left out. */
export type ProviderStatusKind = 'active' | 'userProvided' | 'disabled' | 'unknown';

/** What a provider's status badge and credentials row show. */
export interface ProviderStatusInfo {
  kind: ProviderStatusKind;
  /** Locale key naming where the provider's credentials come from. */
  credentialsKey?: string;
}

/** A purpose group of a provider card (Title generation, Activity labels, …). */
export interface ProviderGroupDef {
  key: string;
  labelKey: string;
  descriptionKey?: string;
  /** Child keys of the provider, in display order. */
  fields: string[];
  /** Opens by default (Agent features, Azure groups); others start collapsed. */
  expanded?: boolean;
  /** Settings LibreChat ignores for this built-in provider: shown last, with an explanation. */
  unused?: boolean;
  /** Pairs of fields shown side by side on wide screens (recursion limits). */
  pairs?: Array<[string, string]>;
}

/** A purpose group resolved against the provider's schema fields. */
export interface ProviderGroup {
  def: ProviderGroupDef;
  fields: SchemaField[];
}

/** A set value of a provider, for the one-line summaries of cards and groups. */
export interface SummaryItem {
  label: string;
  value: string;
}

export interface ProviderCardProps extends Omit<FieldRendererProps, 'fields'> {
  field: SchemaField;
}

export interface ProviderGroupSectionProps extends Omit<
  FieldRendererProps,
  'fields' | 'parentPath' | 'parentValue'
> {
  group: ProviderGroup;
  /** The provider's data path (`endpoints.openAI`). */
  providerPath: string;
  /** The provider's shown value (pending edits included). */
  providerValue: ConfigValue;
  /** Storage id of the group's open state. */
  stateId: string;
  /** A banner above the group's rows (Global title settings). */
  notice?: ReactNode;
  /** Replaces the collapsed summary ("Ignored while Global overrides exist"). */
  summaryOverride?: string;
  /** Shown before the customized count ("9 groups"). */
  countBadge?: ReactNode;
  /** Extra content above the group's rows (the Azure groups table). */
  before?: ReactNode;
  /** Shown after the rows (read-only unknown keys in Advanced). */
  after?: ReactNode;
}

export interface ProviderStatusBadgeProps {
  provider: string;
}

export interface ProviderStatusRowProps {
  provider: string;
}

/** One Azure OpenAI group as the read-only table shows it. */
export interface AzureGroupRow {
  group: string;
  apiKey?: string;
  instanceName?: string;
  baseURL?: string;
  deploymentName?: string;
  version?: string;
  serverless: boolean;
  assistants: boolean;
  models: AzureGroupModel[];
  additionalHeaders?: Record<string, string>;
  addParams?: Record<string, ConfigValue>;
  dropParams?: string[];
}

/** A model of an Azure group: its deployment and API version overrides. */
export interface AzureGroupModel {
  name: string;
  deploymentName?: string;
  version?: string;
  assistants?: boolean;
}

export interface AzureGroupsTableProps {
  path: string;
  value: ConfigValue;
}

export interface AzureGroupDrawerProps {
  group: AzureGroupRow | null;
  onClose: () => void;
  /** The Details button that opened it, focused again on close. */
  returnFocus?: RefObject<HTMLButtonElement | null>;
}

/** A credential shown without its secret: an env reference by name, a literal masked. */
export type MaskedCredential =
  | { kind: 'env'; name: string }
  | { kind: 'masked' }
  | { kind: 'none' };

export interface NetworkAccessCardProps extends Omit<FieldRendererProps, 'fields'> {
  field: SchemaField;
}

/** Why an `allowedAddresses` entry is rejected, as a locale key (first relevant issue only). */
export type AddressIssue = 'empty' | 'url' | 'port' | 'public' | 'format';

/** A server query as the providers editor reads it. */
export interface QueryState<T> {
  data?: T;
  isLoading: boolean;
  isError: boolean;
}

export interface PersistentExpandedOptions {
  /** Storage namespace, one per tab (`providers`). */
  storageKey: string;
  /** Stable id of the collapsible within the namespace. */
  id: string;
  defaultExpanded?: boolean;
  /** Data paths it shows: it opens while the tab filter matches inside them. */
  revealPaths?: readonly string[];
}

export interface PersistentExpanded {
  isExpanded: boolean;
  hasEverExpanded: boolean;
  /** Attach to the section element so deep links (`config:expand`) can open it. */
  sectionRef: RefObject<HTMLElement | null>;
  toggle: () => void;
}

/** What a model list shows from `/api/models` (AP-2). */
export interface ModelListDefaults {
  /** The provider's default models; absent while the saved configuration sets a list. */
  defaults?: string[];
  /** Model names offered while typing. */
  suggestions: string[];
}

/** A run of a group's rows: consecutive fields, or a pair shown side by side. */
export interface FieldRun {
  fields: SchemaField[];
  pair: boolean;
}

export interface SetBadgeProps {
  /** Settings with a value (librechat.yaml or an override). */
  count: number;
  /** Admin overrides among them. */
  overrides?: number;
}

export interface ShadowBadgeProps {
  shadowedBy: ShadowedBy;
  /** Where the overridden value comes from ("librechat.yaml"), named in the reason. */
  source?: string;
}

/** How a summary reads a provider's values. */
export interface SummaryReader {
  /** The path holds a value (librechat.yaml, an override or a pending edit). */
  isSet: (path: string) => boolean;
  valueAt: (path: string) => ConfigValue;
  /** Global overrides take precedence over the value (D11). */
  isShadowed?: (path: string) => boolean;
}

export interface SummaryReaderInput {
  providerPath: string;
  providerValue: ConfigValue;
  getValue: (path: string, fallback: ConfigValue) => ConfigValue;
  configuredPaths?: ReadonlySet<string>;
  editedValues?: FlatConfigMap;
  root: ConfigValue;
}

export interface StaleOverrideProps {
  pendingRemoval: boolean;
  /** Queues the override's removal; absent when the target cannot be edited. */
  onRemove?: () => void;
}
