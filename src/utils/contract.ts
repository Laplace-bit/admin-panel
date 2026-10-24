import type * as t from '@/types';
import {
  CONFIG_FEATURE_FLAGS,
  BUNDLED_CONFIG_RULES,
  BUNDLED_CONFIG_LIMITS,
  BUNDLED_CONFIG_CONTRACT,
} from '@/constants';

/**
 * The contract a server reported, every part it leaves out filled from the
 * bundled fallback: a flag it does not report is off, and a limit or rule it
 * does not report is the one LibreChat enforced before it reported them.
 * `null` (no meta route, or an unreadable reply) is the bundled contract.
 */
export function resolveConfigContract(body: t.AdminConfigMetaBody | null): t.ConfigContract {
  if (!body) return BUNDLED_CONFIG_CONTRACT;
  const reported = body.features ?? {};
  const features = Object.fromEntries(
    CONFIG_FEATURE_FLAGS.map((flag) => [flag, reported[flag] === true]),
  ) as Record<t.ConfigFeatureFlag, boolean>;
  const versions = body.versions;
  return {
    source: 'server',
    versions:
      versions?.librechat != null && versions.dataProvider != null && versions.configSchema != null
        ? {
            librechat: versions.librechat,
            dataProvider: versions.dataProvider,
            configSchema: versions.configSchema,
          }
        : undefined,
    features,
    limits: { ...BUNDLED_CONFIG_LIMITS, ...definedOnly(body.limits) },
    rules: { ...BUNDLED_CONFIG_RULES, ...definedOnly(body.rules) },
  };
}

/** A copy without the keys whose value is `undefined`, so they don't hide the fallback's. */
function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
