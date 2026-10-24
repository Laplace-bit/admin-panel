import { PrincipalType } from 'librechat-data-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as t from '@/types';
import { BUNDLED_CONFIG_FEATURES } from '@/constants';
import { EditRoleDialog } from '../EditRoleDialog';

const state = vi.hoisted(() => ({
  features: {} as Record<string, boolean>,
  scopes: [] as Array<Pick<t.ConfigScope, 'principalType' | 'principalId'>>,
}));

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}(${Object.values(options).join(',')})` : key,
  useConfigFeatures: () => state.features,
}));

vi.mock('@/server', () => ({
  MEMBERS_PAGE_SIZE: 20,
  roleQueryOptions: (name: string) => ({
    queryKey: ['role', name],
    queryFn: async () => ({ ...role, permissions: {} }),
  }),
  roleMembersQueryOptions: (id: string, page: number) => ({
    queryKey: ['roleMembers', id, page],
    queryFn: async () => ({ members: [], total: 0 }),
  }),
  availableScopesOptions: {
    queryKey: ['availableScopes'],
    queryFn: async () => state.scopes,
  },
  updateRoleFn: vi.fn(),
  addRoleMemberFn: vi.fn(),
  removeRoleMemberFn: vi.fn(),
  updateRolePermissionsFn: vi.fn(),
}));

vi.mock('../RolePermissionsPanel', () => ({ RolePermissionsPanel: () => null }));

const role: t.Role = {
  id: 'r1',
  name: 'EDITORS',
  description: '',
  isSystemRole: false,
  isActive: true,
  userCount: 0,
  permissions: {},
} as t.Role;

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <EditRoleDialog role={role} canManage onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function rename(name: string) {
  const input = await screen.findByLabelText('com_access_col_name');
  fireEvent.change(input, { target: { value: name } });
}

beforeEach(() => {
  state.features = { ...BUNDLED_CONFIG_FEATURES };
  state.scopes = [{ principalType: PrincipalType.ROLE, principalId: 'EDITORS' }];
});

describe('EditRoleDialog rename note', () => {
  it('warns that the profile stays under the old name on a server that does not move it', async () => {
    renderDialog();
    await rename('WRITERS');
    expect(
      await screen.findByText('com_access_rename_profile_warning(EDITORS)'),
    ).toBeInTheDocument();
  });

  it('says the profile moves with the role when the server moves it', async () => {
    state.features = { ...BUNDLED_CONFIG_FEATURES, roleRenameMovesProfile: true };
    renderDialog();
    await rename('WRITERS');
    expect(await screen.findByText('com_access_rename_profile_moves')).toBeInTheDocument();
    expect(screen.queryByText(/com_access_rename_profile_warning/)).not.toBeInTheDocument();
  });

  it('says nothing once the name is back to the current one', async () => {
    renderDialog();
    await rename('WRITERS');
    expect(await screen.findByText(/com_access_rename_profile_warning/)).toBeInTheDocument();
    await rename('EDITORS');
    expect(screen.queryByText(/com_access_rename_profile/)).not.toBeInTheDocument();
  });

  it('says nothing for a role without a profile', async () => {
    state.scopes = [{ principalType: PrincipalType.GROUP, principalId: 'EDITORS' }];
    renderDialog();
    await rename('WRITERS');
    await act(async () => {});
    expect(screen.queryByText(/com_access_rename_profile/)).not.toBeInTheDocument();
  });
});
