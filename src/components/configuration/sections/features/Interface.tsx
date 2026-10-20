import { useContext } from 'react';
import type * as t from '@/types';
import { INTERFACE_GROUPS, INTERFACE_OTHER_GROUP } from '@/constants';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { UnknownSettings } from '../../UnknownSettings';
import { FeatureGroup } from './Group';

const GROUPED_KEYS: ReadonlySet<string> = new Set(
  INTERFACE_GROUPS.flatMap((group) => group.fields),
);

/**
 * Interface settings by purpose (FX-5): chat controls, onboarding and legal
 * (welcome text, privacy policy, terms of service), retention, sharing,
 * scheduling, the trace viewer and the MCP menu. Fields no group lists (a
 * newer schema) follow in "More settings", and keys the schema doesn't know
 * are listed read-only at the end (D8).
 */
export function InterfaceRenderer(props: t.FieldRendererProps) {
  const rowFilter = useContext(RowFilterContext);
  const { fields, parentValue, parentPath } = props;
  const other: t.FeatureGroupDef = {
    ...INTERFACE_OTHER_GROUP,
    fields: fields.filter((field) => !GROUPED_KEYS.has(field.key)).map((field) => field.key),
  };
  return (
    <>
      {[...INTERFACE_GROUPS, other].map((group) => (
        <FeatureGroup key={group.key} {...props} group={group} allFields={fields} />
      ))}
      {!rowFilter && <UnknownSettings fields={fields} value={parentValue} path={parentPath} />}
    </>
  );
}
