import type * as t from '@/types';
import { PROVIDER_CREDENTIALS_KEYS } from '@/constants';

/**
 * A provider's runtime status from `/api/endpoints` (AP-5): served (with the
 * server's credentials, or each user's), not enabled (left out of the list),
 * or unknown while the list is missing.
 */
export function providerStatus(
  provider: string,
  endpoints: t.EndpointStatusMap | undefined,
): t.ProviderStatusInfo {
  const credentialsKey = PROVIDER_CREDENTIALS_KEYS[provider];
  if (!endpoints) return { kind: 'unknown', credentialsKey };
  const entry = endpoints[provider];
  if (!entry) return { kind: 'disabled', credentialsKey };
  return { kind: entry.userProvide ? 'userProvided' : 'active', credentialsKey };
}

/** Locale keys of a status kind's label and explanation. */
export const STATUS_KEYS: Readonly<Record<t.ProviderStatusKind, { label: string; desc: string }>> =
  {
    active: {
      label: 'com_config_providers_status_active',
      desc: 'com_config_providers_status_active_desc',
    },
    userProvided: {
      label: 'com_config_providers_status_userProvided',
      desc: 'com_config_providers_status_userProvided_desc',
    },
    disabled: {
      label: 'com_config_providers_status_disabled',
      desc: 'com_config_providers_status_disabled_desc',
    },
    unknown: {
      label: 'com_config_providers_status_unknown',
      desc: 'com_config_providers_status_unknown_desc',
    },
  };
