import { useState } from 'react';
import { ButtonGroup } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { TextareaField } from '../../fields/TextareaField';
import { defaultChoiceLabel } from '../../fields/display';
import { useLocalize } from '@/hooks';

type Mode = 'default' | 'off' | 'server' | 'custom';

function modeOf(value: t.ConfigValue): Mode {
  if (value === true) return 'server';
  if (value === false) return 'off';
  if (typeof value === 'string') return 'custom';
  return 'default';
}

const MODE_VALUE: Readonly<Record<'off' | 'server', boolean>> = { off: false, server: true };

/**
 * Server instructions (MCP-7): none, the instructions the server provides
 * (`true`), or the admin's own text, with a "Default (…)" choice that keeps
 * no value of its own. Custom text gets a textarea; switching to Custom
 * waits for text before anything is stored.
 */
export function InstructionsField({
  id,
  value,
  fieldDefault,
  onChange,
  onClear,
  'aria-label': ariaLabel,
}: {
  id: string;
  value: t.ConfigValue;
  fieldDefault: t.FieldDefault;
  onChange: (value: t.ConfigValue) => void;
  onClear: () => boolean | void;
  'aria-label': string;
}) {
  const localize = useLocalize();
  const own = fieldDefault.hasOwnValue ? value : undefined;
  const valueMode = modeOf(own);
  const [pendingCustom, setPendingCustom] = useState(false);
  const mode = pendingCustom && valueMode !== 'custom' ? 'custom' : valueMode;
  const defaultLabel = defaultChoiceLabel(fieldDefault, localize, {
    true: localize('com_config_mcp_instructions_server'),
    false: localize('com_config_ctl_off'),
  });
  const options: Array<{ value: Mode; label: string }> = [
    { value: 'default', label: defaultLabel },
    { value: 'off', label: localize('com_config_ctl_off') },
    { value: 'server', label: localize('com_config_mcp_instructions_server') },
    { value: 'custom', label: localize('com_config_mcp_instructions_custom') },
  ];

  const choose = (next: Mode) => {
    if (next === mode) return;
    setPendingCustom(next === 'custom');
    if (next === 'default') onClear();
    else if (next !== 'custom') onChange(MODE_VALUE[next]);
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <ButtonGroup
        id={id}
        aria-label={ariaLabel}
        className="max-w-full self-start"
        options={options}
        selected={mode}
        onClick={(next) => choose(next as Mode)}
      />
      {mode === 'custom' && (
        <TextareaField
          id={`${id}-text`}
          value={typeof own === 'string' ? own : ''}
          onChange={(next) => {
            setPendingCustom(false);
            onChange(next);
          }}
          onClear={() => {
            setPendingCustom(false);
            return onClear();
          }}
          placeholder={localize('com_config_mcp_instructions_placeholder')}
          aria-label={localize('com_config_mcp_instructions_custom_label')}
        />
      )}
    </div>
  );
}
