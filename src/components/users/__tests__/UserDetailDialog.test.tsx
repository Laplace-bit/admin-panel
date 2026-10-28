import { describe, it, vi } from 'vitest';
import type { TUser } from 'librechat-data-provider';
import { DIALOG_CLOSERS, expectFocusBack, openFrom, renderWithOpener } from '@/test/focus';
import { UserDetailDialog } from '../UserDetailDialog';

vi.mock('@/server', () => {
  const empty = (key: string) => ({ queryKey: [key], queryFn: () => Promise.resolve([]) });
  return {
    roleAssignmentsQueryOptions: { queryKey: ['roleAssignments'], queryFn: () => ({}) },
    groupAssignmentsQueryOptions: { queryKey: ['groupAssignments'], queryFn: () => ({}) },
    allRolesQueryOptions: empty('allRoles'),
    allGroupsQueryOptions: empty('allGroups'),
    availableScopesOptions: empty('availableScopes'),
    addGroupMemberFn: vi.fn(),
    addRoleMemberFn: vi.fn(),
    createScopeFn: vi.fn(),
    deleteScopeFn: vi.fn(),
    removeGroupMemberFn: vi.fn(),
    removeRoleMemberFn: vi.fn(),
  };
});

const USER: TUser = {
  id: 'u-jane',
  name: 'Jane Doe',
  username: 'jane',
  email: 'jane@example.com',
  avatar: '',
  role: 'USER',
  provider: 'local',
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

describe('UserDetailDialog focus', () => {
  it.each(DIALOG_CLOSERS)(
    'gives focus back to the user row that opened it on %s',
    async (_, close) => {
      const opener = renderWithOpener((open, onClose) => (
        <UserDetailDialog user={open ? USER : null} onClose={onClose} />
      ));
      close(await openFrom(opener));
      await expectFocusBack(opener);
    },
  );
});
