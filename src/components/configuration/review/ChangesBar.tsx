import { useRef } from 'react';
import type * as t from '@/types';
import { useLocalize, useToastClearance, useRefocusWhenGone } from '@/hooks';
import { StickyActionBar } from '@/components/shared';
import { activeConfigTab } from '@/utils';

/**
 * The unsaved-changes bar (WS7): how many changes Save would write and on
 * which tabs, with Review and Discard (which offers Undo). Shown on every
 * tab, read-only ones included, while edits are pending. Discard takes the bar
 * away with its own button, so focus goes to the open tab.
 */
export function ChangesBar({ review }: t.ChangesBarProps) {
  const requestRefocus = useRefocusWhenGone(review.isDirty, [activeConfigTab]);
  if (!review.isDirty) return null;
  return <ShownChangesBar review={review} onDiscard={requestRefocus} />;
}

function ShownChangesBar({ review, onDiscard }: t.ShownChangesBarProps) {
  const localize = useLocalize();
  const barRef = useRef<HTMLDivElement>(null);
  useToastClearance(barRef);
  const { count, tabTitles } = review.model;
  /** The count is a status message (WCAG 4.1.3): screen readers hear it change without moving to the bar. */
  const message = (
    <span role="status" aria-live="polite" aria-atomic="true">
      {count === 0 ? (
        <span className="text-(--cui-color-text-muted)">
          {localize('com_config_review_bar_none')}
        </span>
      ) : (
        <>
          <span className="font-medium">{localize('com_config_review_bar', { count })}</span>
          {tabTitles.length > 0 && (
            <span className="hidden text-(--cui-color-text-muted) sm:inline">
              {' '}
              · {tabTitles.join(', ')}
            </span>
          )}
        </>
      )}
    </span>
  );
  return (
    <div ref={barRef} className="shrink-0">
      <StickyActionBar
        label={localize('com_config_unsaved_changes')}
        message={message}
        discardLabel={localize('com_config_discard')}
        saveLabel={localize('com_config_review_bar_review')}
        onDiscard={() => {
          onDiscard();
          review.discardAll();
        }}
        onSave={review.openReview}
      />
    </div>
  );
}
