import type { ReactNode } from 'react';
import type * as t from '@/types';
import { DecorativeIcon } from '@/components/shared';
import { cn } from '@/utils';

const ICONS: Readonly<Record<t.McpNoteTone, 'lock' | 'info-in-circle' | 'warning'>> = {
  lock: 'lock',
  info: 'info-in-circle',
  warning: 'warning',
};

/**
 * A grey note inside a server card or the create dialog: why something is
 * read-only (lock), what a choice means (info), or what a change will remove
 * (warning), with optional actions on the right.
 */
export function McpNote({
  tone,
  children,
  actions,
  id,
}: {
  tone: t.McpNoteTone;
  children: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <div
      id={id}
      role={tone === 'warning' ? 'alert' : 'note'}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm text-(--cui-color-text-default)',
        tone === 'warning'
          ? 'border-(--cui-color-stroke-intense) bg-(--cui-color-background-muted)'
          : 'border-(--cui-color-stroke-default) bg-(--cui-color-background-secondary)',
      )}
    >
      <span className="flex shrink-0 self-start pt-0.5 text-(--cui-color-text-muted)">
        <DecorativeIcon name={ICONS[tone]} size="sm" />
      </span>
      <span className="min-w-0 flex-[1_1_14rem]">{children}</span>
      {actions && <span className="flex shrink-0 items-center gap-2">{actions}</span>}
    </div>
  );
}
