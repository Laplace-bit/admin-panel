import { allowedAddressesSchema } from 'librechat-data-provider';
import type * as t from '@/types';

/** LibreChat's `allowedAddresses` refinements, in the order it checks them. */
const ISSUE_PATTERNS: ReadonlyArray<[RegExp, t.AddressIssue]> = [
  [/non-empty/, 'empty'],
  [/host:port pairs/, 'url'],
  [/include a port/, 'port'],
  [/private IP space/, 'public'],
];

export const ADDRESS_ISSUE_KEYS: Readonly<Record<t.AddressIssue, string>> = {
  empty: 'com_config_providers_network_issue_empty',
  url: 'com_config_providers_network_issue_url',
  port: 'com_config_providers_network_issue_port',
  public: 'com_config_providers_network_issue_public',
  format: 'com_config_providers_network_issue_format',
};

/**
 * The first problem LibreChat would report for an `allowedAddresses` entry
 * (AP-7), checked with its own schema: Zod runs every refinement, so
 * `localhost` fails both "include a port" and "private IP space", and only
 * the first is relevant. Null when the entry is valid.
 */
export function addressIssue(entry: string): t.AddressIssue | null {
  const result = allowedAddressesSchema.safeParse([entry]);
  if (result.success) return null;
  const message = result.error.issues[0]?.message ?? '';
  return ISSUE_PATTERNS.find(([pattern]) => pattern.test(message))?.[1] ?? 'format';
}
