import { useMemo, useState, useEffect, useRef } from 'react';
import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { MODEL_KEYS, PROMPT_KEYS, PRESET_DENYLIST, paramField, presetParams } from './params';
import { INPUT_CLASSES, widthClass } from '../../fields/display';
import { renderInlineField, toFieldId } from '../../renderer';
import { describeField, labelForPath } from '../../meta';
import { useFieldError, useLocalize } from '@/hooks';
import { FieldControl } from '../../renderer/FieldControl';
import { CodeField } from '../../fields/CodeField';
import { SettingsRow } from '../../SettingsRow';
import { specEndpoint } from './validation';
import { useSpecList } from './context';
import { cn, isConfigRecord } from '@/utils';

const PICK = '\u0000pick';

function textOf(value: t.ConfigValue): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** One model parameter: the shared control with the endpoint's range, choices and default. */
function ParamRow({
  field,
  param,
  value,
  path,
  onChange,
  disabled,
  editSessionId,
}: {
  field: t.SchemaField;
  param: t.PresetParam;
  value: t.ConfigValue;
  path: string;
  onChange: (key: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  editSessionId?: number;
}) {
  const localize = useLocalize();
  const dataPath = `${path}.${param.key}`;
  const id = toFieldId(dataPath);
  const label = labelForPath(dataPath, localize);
  const error = useFieldError(dataPath);
  const shaped = paramField(field, param);
  return (
    <SettingsRow
      label={label}
      htmlFor={id}
      description={describeField(field, localize)}
      error={error}
      marker={error ? 'error' : undefined}
      control={
        <FieldControl
          field={shaped}
          path={dataPath}
          id={id}
          label={label}
          value={value}
          onChange={(next) => onChange(param.key, next)}
          onClear={() => {
            onChange(param.key, undefined);
            return true;
          }}
          fieldDefault={{
            hasOwnValue: value !== undefined,
            value: param.defaultValue,
            source: 'runtimeDefault',
          }}
          disabled={disabled}
          editSessionId={editSessionId}
        />
      }
    />
  );
}

/**
 * A spec's model parameters (MS-4), driven by LibreChat's own parameter
 * settings for its endpoint and model: only the parameters that endpoint
 * offers, with their ranges, choices and defaults. Preset fields the spec
 * sets that the endpoint doesn't offer stay listed (so they can be changed or
 * removed); "Advanced (raw)" adds any other preset field LibreChat accepts,
 * internal conversation fields excepted, or edits the preset as YAML.
 */
export function PresetEditor({
  presetField,
  preset,
  path,
  onChange,
  onReplace,
  disabled,
  editSessionId,
}: t.PresetEditorProps) {
  const localize = useLocalize();
  const { options, configuredOnly } = useSpecList();
  const [addedKeys, setAddedKeys] = useState<string[]>([]);
  const [rawOpen, setRawOpen] = useState(false);
  const focusKeyRef = useRef<string | null>(null);
  const endpoint = specEndpoint({ preset });
  const model = textOf(preset.model);
  const children = presetField.children ?? [];
  const byKey = useMemo(() => new Map(children.map((field) => [field.key, field])), [children]);
  const { params } = useMemo(
    () => presetParams(endpoint, model, options.customEndpoint(endpoint), new Set(byKey.keys())),
    [endpoint, model, options, byKey],
  );
  const endpointLabel =
    options.endpoints.find((option) => option.value === endpoint)?.label ?? endpoint;

  const handled = new Set([...MODEL_KEYS, ...PROMPT_KEYS, ...params.map((param) => param.key)]);
  const others = children.filter(
    (field) =>
      !handled.has(field.key) && (preset[field.key] !== undefined || addedKeys.includes(field.key)),
  );
  const pickable = children
    .filter(
      (field) =>
        !handled.has(field.key) &&
        !PRESET_DENYLIST.has(field.key) &&
        preset[field.key] === undefined &&
        !addedKeys.includes(field.key),
    )
    .map((field) => ({
      value: field.key,
      label: localize('com_config_specs_raw_option', {
        label: labelForPath(`${path}.${field.key}`, localize),
        key: field.key,
      }),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  useEffect(() => {
    const key = focusKeyRef.current;
    if (!key) return;
    focusKeyRef.current = null;
    const el = document.getElementById(toFieldId(`${path}.${key}`));
    const target = el?.matches('input, select, textarea, button')
      ? el
      : el?.querySelector<HTMLElement>('input, select, textarea, button');
    target?.focus();
  });

  return (
    <>
      {!endpoint && !configuredOnly && (
        <p className="settings-group-desc">{localize('com_config_specs_params_no_endpoint')}</p>
      )}
      {endpoint && params.length === 0 && !configuredOnly && (
        <p className="settings-group-desc">
          {localize('com_config_specs_params_none', { endpoint: endpointLabel })}
        </p>
      )}
      {params.map((param) => {
        const field = byKey.get(param.key);
        if (!field || (configuredOnly && preset[param.key] === undefined)) return null;
        return (
          <ParamRow
            key={param.key}
            field={field}
            param={param}
            value={preset[param.key]}
            path={path}
            onChange={onChange}
            disabled={disabled}
            editSessionId={editSessionId}
          />
        );
      })}
      {others.length > 0 && (
        <>
          <p className="settings-group-desc mt-2">
            <span className="font-medium text-(--cui-color-text-default)">
              {localize('com_config_specs_params_other')}
            </span>{' '}
            {localize('com_config_specs_params_other_desc', {
              endpoint: endpointLabel || localize('com_config_specs_this_endpoint'),
            })}
          </p>
          {others.map((field) =>
            renderInlineField(
              field,
              preset,
              path,
              onChange,
              localize,
              disabled,
              undefined,
              false,
              editSessionId,
            ),
          )}
        </>
      )}
      {!disabled && !configuredOnly && (
        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            className="settings-row-action self-start"
            aria-expanded={rawOpen}
            aria-controls={`${toFieldId(path)}-raw`}
            onClick={() => setRawOpen((open) => !open)}
          >
            {localize('com_config_specs_raw')}
          </button>
          {rawOpen && (
            <div id={`${toFieldId(path)}-raw`} className="flex flex-col gap-3">
              <p className="m-0 text-xs text-(--cui-color-text-muted)">
                {localize('com_config_specs_raw_desc')}
              </p>
              {pickable.length > 0 && (
                <div className={cn('relative w-full', widthClass('M'))}>
                  <select
                    id={`${toFieldId(path)}-raw-add`}
                    value={PICK}
                    aria-label={localize('com_config_specs_raw_add')}
                    onChange={(event) => {
                      const key = event.target.value;
                      if (key === PICK) return;
                      focusKeyRef.current = key;
                      setAddedKeys((keys) => [...keys, key]);
                    }}
                    className={cn(INPUT_CLASSES, 'cursor-pointer appearance-none pr-8')}
                  >
                    <option value={PICK} disabled>
                      {localize('com_config_specs_raw_add')}
                    </option>
                    {pickable.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 text-(--cui-color-text-muted)"
                  >
                    <Icon name="plus" size="sm" />
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${toFieldId(path)}-yaml`}
                  className="text-xs font-medium text-(--cui-color-text-default)"
                >
                  {localize('com_config_specs_raw_yaml')}
                </label>
                <CodeField
                  id={`${toFieldId(path)}-yaml`}
                  value={preset}
                  onChange={(next) => onReplace(isConfigRecord(next) ? next : {})}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
