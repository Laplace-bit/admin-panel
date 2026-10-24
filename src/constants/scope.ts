import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import { BUNDLED_WRITE_RULES, DEDICATED_CONFIG_SECTIONS, getConfigSection } from './config';

export const SCOPE_TYPE_CONFIG: Record<t.ScopePrincipalType | 'BASE', t.ScopeTypeConfigEntry> = {
  BASE: {
    icon: 'settings',
    color: 'var(--cui-color-accent-success)',
    labelKey: 'com_scope_base_config',
    badgeClass: '',
  },
  [PrincipalType.ROLE]: {
    icon: 'briefcase',
    color: 'var(--cui-color-accent-warning)',
    labelKey: 'com_scope_roles',
    badgeClass: 'badge-role',
  },
  [PrincipalType.GROUP]: {
    icon: 'users',
    color: 'var(--cui-color-accent-info)',
    labelKey: 'com_scope_groups',
    badgeClass: 'badge-group',
  },
  [PrincipalType.USER]: {
    icon: 'user',
    color: 'var(--cui-color-accent-user)',
    labelKey: 'com_scope_users',
    badgeClass: 'badge-user',
  },
};

/** Safe lookup — falls back to BASE config if the type has no scope entry (e.g. PUBLIC). */
export function getScopeTypeConfig(type: PrincipalType | 'BASE'): t.ScopeTypeConfigEntry {
  return SCOPE_TYPE_CONFIG[type as t.ScopePrincipalType | 'BASE'] ?? SCOPE_TYPE_CONFIG.BASE;
}

/**
 * Priority each kind of profile is created with. Higher priority wins, so by
 * default users override groups, groups override roles, and roles override Base.
 */
export const DEFAULT_SCOPE_PRIORITY: Readonly<Record<t.ScopePrincipalType, number>> = {
  [PrincipalType.ROLE]: 10,
  [PrincipalType.GROUP]: 20,
  [PrincipalType.USER]: 100,
};

/** The highest priority the panel sets (the admin API takes any number of 0 or more). */
export const MAX_SCOPE_PRIORITY = 1_000_000;

/** Sections LibreChat reads before sign-in, when no role, group or user profile can apply. */
const PRE_AUTH_SECTIONS: ReadonlySet<string> = new Set(['registration']);

/**
 * Why `path` (or its section) cannot be set per profile, if it can't (WS8):
 * a section read before sign-in, a tenant-wide one, or one read-only
 * everywhere (by the server's write `rules`). In a profile they render as an
 * "Applies to everyone — edit in Base" card and their paths are never sent.
 */
export function getScopeGateReason(
  path: string,
  rules: t.ConfigWriteRules = BUNDLED_WRITE_RULES,
): t.ScopeGateReason | undefined {
  const section = getConfigSection(path);
  if (PRE_AUTH_SECTIONS.has(section)) return 'preAuth';
  if (DEDICATED_CONFIG_SECTIONS.has(section)) return 'tenantWide';
  return rules.readOnlySections.get(section);
}
