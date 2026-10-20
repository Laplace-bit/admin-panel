import { useMemo } from 'react';
import type * as t from '@/types';
import { SPEC_LIST_PATH, validateSpecs } from './validation';
import { UnknownSettings } from '../../UnknownSettings';
import { SpecsSettings } from './SpecsSettings';
import { useSpecOptions } from './options';
import { SpecList } from './SpecList';
import { isConfigRecord } from '@/utils';

const NO_ITEMS: t.ConfigValue[] = [];

/**
 * The Model specs tab (WS11): how users pick models (specs only, specs
 * first, endpoints first) with the endpoints listed beside the specs, then
 * the spec list and its editor. Specs are validated as the admin edits them;
 * errors show on the spec and its fields and block Save (MS-2).
 */
export function ModelSpecsRenderer(props: t.ModelSpecsRendererProps) {
  const { fields, parentValue, parentPath, getValue } = props;
  const listField = fields.find((field) => field.key === 'list');
  const stored = isConfigRecord(parentValue) ? parentValue.list : undefined;
  const value = getValue(SPEC_LIST_PATH, stored ?? NO_ITEMS);
  const items = Array.isArray(value) ? value : NO_ITEMS;
  const options = useSpecOptions(items);
  const problems = useMemo(
    () => validateSpecs(items, { knownEndpoints: options.knownEndpoints }),
    [items, options.knownEndpoints],
  );

  return (
    <>
      <SpecsSettings {...props} items={items} options={options} />
      {listField && (
        <SpecList
          {...props}
          listField={listField}
          items={items}
          options={options}
          problems={problems}
        />
      )}
      <UnknownSettings fields={fields} value={parentValue} path={parentPath} />
    </>
  );
}
