import { Button } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

/**
 * A stored Azure groups override LibreChat does not apply (D13, HF-9): it has
 * no effect today but would take over once LibreChat re-processes overrides,
 * so it can be queued for removal.
 */
export function StaleOverride({ pendingRemoval, onRemove }: t.StaleOverrideProps) {
  const localize = useLocalize();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-md border border-(--cui-color-stroke-default) px-3 py-2 text-xs text-(--cui-color-text-default)"
    >
      <span className="flex-1">
        {localize(
          pendingRemoval ? 'com_config_stale_override_pending' : 'com_config_providers_azure_stale',
        )}
      </span>
      {onRemove && !pendingRemoval && (
        <Button
          htmlType="button"
          type="secondary"
          label={localize('com_config_remove_stale_override')}
          onClick={onRemove}
        />
      )}
    </div>
  );
}
