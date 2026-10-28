import { describe, it, vi } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import { fireEvent, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type * as t from '@/types';
import { expectFocusBack, openFrom, pressEscape, renderWithOpener } from '@/test/focus';
import { AuditLogDetailDrawer } from '../AuditLogDetailDrawer';
import { localizeEn } from '@/test/coverage';

type DrawerProps = ComponentProps<typeof AuditLogDetailDrawer>;

const ENTRY: t.AuditLogEntryWithDiff = {
  id: '0123456789abcdef01234567',
  schemaVersion: 1,
  category: 'grant',
  action: 'grant.assigned',
  outcome: 'success',
  severity: 'info',
  actor: { type: 'user', id: 'u-admin', name: 'Admin' },
  target: { type: PrincipalType.ROLE, id: 'EDITORS', name: 'EDITORS' },
  metadata: { capability: 'read:configs' },
  integrity: { seq: 1, hash: 'hash', prevHash: 'prev' },
  timestamp: '2026-10-01T12:00:00.000Z',
};

/** What the drawer shows while open: the entry, or the shell for a deep link still loading, missing or failed. */
const BRANCHES: ReadonlyArray<[string, (open: boolean) => Partial<DrawerProps>]> = [
  ['an entry', (open) => ({ entry: open ? ENTRY : null })],
  ['a loading deep link', (open) => ({ loading: open })],
  ['a missing entry', (open) => ({ notFound: open })],
  ['an entry that failed to load', (open) => ({ loadError: open })],
];

const CLOSERS: ReadonlyArray<[string, (drawer: HTMLElement) => void]> = [
  ['Escape', pressEscape],
  [
    'its close button',
    (drawer) =>
      fireEvent.click(
        within(drawer).getAllByRole('button', { name: localizeEn('com_audit_detail_close') })[0],
      ),
  ],
];

describe('AuditLogDetailDrawer focus', () => {
  describe.each(BRANCHES)('showing %s', (_, branch) => {
    it.each(CLOSERS)('gives focus back to the row that opened it on %s', async (__, close) => {
      const opener = renderWithOpener((open, onClose) => (
        <AuditLogDetailDrawer
          entry={null}
          {...branch(open)}
          open={open}
          onClose={onClose}
          onCopyPermalink={vi.fn()}
        />
      ));
      close(await openFrom(opener));
      await expectFocusBack(opener);
    });
  });
});
