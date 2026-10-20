import type * as t from '@/types';
import { useLocalize, useFieldState, useValuesScope, useRevertLabels } from '@/hooks';
import { layerRevertTarget, lowerLayerValue } from '../../renderer/defaults';
import { DecorativeIcon, StateChip } from '@/components/shared';
import { isConfigRecord, isConfigValueEqual } from '@/utils';
import { sourceLabel } from '../../values';

/** Unset, empty text and empty lists or objects all read as "not set" when comparing with the saved value. */
function normalize(value: t.ConfigValue): t.ConfigValue {
  if (value === null || value === '') return undefined;
  if (Array.isArray(value) && value.length === 0) return undefined;
  if (isConfigRecord(value) && Object.keys(value).length === 0) return undefined;
  return value;
}

/**
 * Chips of one endpoint field (WS10 CE-2): "Edited" with Undo while the field
 * differs from its saved value; otherwise, for an endpoint the layer beneath
 * defines, when the edit target overrides one of its values, "Admin
 * override" (or the profile) with "Revert to librechat.yaml (…)" / "Remove
 * override (inherits …)". Values the endpoint simply inherits, and endpoints
 * the target added, carry no such chip: the drawer header names the source.
 */
export function FieldChips({
  path,
  label,
  value,
  saved,
  showOverride,
  onChange,
  onRevert,
  disabled,
}: t.FieldChipsProps) {
  const localize = useLocalize();
  const state = useFieldState(path);
  const scope = useValuesScope();
  const revert = useRevertLabels(path, label);
  if (disabled) return null;
  const handleRevert = (): void => {
    if (onRevert) {
      onRevert();
      return;
    }
    const target = state.isOverride
      ? layerRevertTarget(state.revertTarget)
      : lowerLayerValue(state);
    onChange(target?.value);
  };

  if (!isConfigValueEqual(normalize(value), normalize(saved))) {
    return (
      <StateChip
        kind="edited"
        description={localize('com_config_ui_state_edited_desc')}
        onUndo={() => onChange(saved)}
        undoLabel={localize('com_config_ui_undo_change', { name: label })}
      />
    );
  }
  if (!showOverride || !state.isOverride) return null;
  return (
    <>
      <StateChip
        kind={scope ? 'scope' : 'override'}
        label={scope ? sourceLabel('scope', localize, scope) : sourceLabel('admin', localize)}
        description={localize(
          scope ? 'com_config_ce_field_override_scope_desc' : 'com_config_ce_field_override_desc',
        )}
      />
      {revert && (
        <button
          type="button"
          className="settings-row-action"
          onClick={handleRevert}
          aria-label={revert.ariaLabel}
          title={revert.label}
        >
          <DecorativeIcon name="history" size="xs" />
          {localize('com_config_ce_revert')}
        </button>
      )}
    </>
  );
}
