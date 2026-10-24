import { Button } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

/** The notice's text and button: a stale override, or one LibreChat applies (`applied`). */
const TEXT_KEYS = {
  stale: {
    shown: 'com_config_providers_azure_stale',
    pending: 'com_config_stale_override_pending',
    remove: 'com_config_remove_stale_override',
  },
  applied: {
    shown: 'com_config_providers_azure_override_applied',
    pending: 'com_config_providers_azure_override_pending',
    remove: 'com_config_remove_azure_override',
  },
} as const;

/**
 * A stored Azure groups override (D13, HF-9). Before `azureGroupSecrets`
 * LibreChat does not apply it: it has no effect today but would take over
 * once LibreChat re-processes overrides. Once it does, the override replaces
 * the groups beneath. Either way it can be queued for removal.
 */
export function StaleOverride({ pendingRemoval, onRemove, applied }: t.StaleOverrideProps) {
  const localize = useLocalize();
  const keys = TEXT_KEYS[applied ? 'applied' : 'stale'];
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-md border border-(--cui-color-stroke-default) px-3 py-2 text-xs text-(--cui-color-text-default)"
    >
      <span className="flex-1">{localize(pendingRemoval ? keys.pending : keys.shown)}</span>
      {onRemove && !pendingRemoval && (
        <Button
          htmlType="button"
          type="secondary"
          label={localize(keys.remove)}
          onClick={onRemove}
        />
      )}
    </div>
  );
}
