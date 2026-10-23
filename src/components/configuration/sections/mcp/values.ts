import type * as t from '@/types';
import { isConfigRecord } from '@/utils';

/** Whether a value sets something: not unset, blank, or an empty list or object. */
export function hasValue(value: t.ConfigValue): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return !isConfigRecord(value) || Object.keys(value).length > 0;
}

/** The value as an object, or an empty one. */
export function asRecord(value: t.ConfigValue): t.ConfigRecord {
  return isConfigRecord(value) ? value : {};
}
