import { useMemo } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { configSchema, PrincipalType } from 'librechat-data-provider';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import type * as t from '@/types';
import {
  baseConfigFixture,
  valuesDataFixture,
  scopeConfigFixture,
  FIXTURE_SCHEMA_PATHS,
} from '@/test/layers';
import {
  flattenObject,
  withScopeLayer,
  createPathIndex,
  deriveFieldValue,
  createBaseLayers,
} from '@/utils';
import { extractSchemaTree, getSchemaPathSet } from '@/server/config';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { usePendingConfigValues } from '@/hooks/config/layers';
import { useConfigEdits } from '@/hooks/config/edits';
import { McpServersRenderer } from '../Servers';

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string, options?: Record<string, string | number>) =>
    options?.name != null ? `${key}:${options.name}` : key,
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options?.name != null ? `${key}:${options.name}` : key,
}));

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const mcpFields = tree.find((field) => field.key === 'mcpServers')?.children ?? [];

const YAML_SERVERS: t.ConfigRecord = {
  github: {
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: '{{PAT_TOKEN}}' },
    timeout: 60000,
    startup: false,
    serverInstructions: true,
  },
  everything: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] },
  cloudflare: { type: 'streamable-http', url: 'https://mcp.cloudflare.com/mcp' },
};

const DB_SERVERS: t.ConfigRecord = {
  github: { timeout: 45000 },
  acme: {
    type: 'streamable-http',
    url: 'https://mcp.acme.dev/mcp',
    headers: { 'X-Team': 'docs' },
    title: 'Acme Docs',
  },
};

function baseData(extra: t.ConfigRecord = {}): t.BaseConfigData {
  const yaml = { mcpServers: YAML_SERVERS };
  const overrides = { mcpServers: { ...DB_SERVERS, ...extra } };
  const merged: t.ConfigRecord = {
    mcpServers: {
      ...YAML_SERVERS,
      github: { ...(YAML_SERVERS.github as t.ConfigRecord), timeout: 45000 },
      acme: DB_SERVERS.acme,
      ...extra,
    },
  };
  return baseConfigFixture({
    config: merged,
    yamlConfig: yaml,
    yamlPaths: Object.keys(flattenObject(yaml)),
    dbOverrides: overrides,
    schemaDefaults: {},
  });
}

function layersFor(
  scope: boolean,
  scopeData?: Partial<t.ResolvedConfigData>,
  extra?: t.ConfigRecord,
): t.ValueLayers {
  const base = createBaseLayers(baseData(extra), FIXTURE_SCHEMA_PATHS);
  if (!scope) return base;
  return withScopeLayer(
    base,
    { principalType: PrincipalType.ROLE, name: 'USER' },
    scopeConfigFixture({
      resolvedConfig: {},
      changedPaths: [],
      overrides: {},
      tombstones: [],
      ...scopeData,
    }),
    FIXTURE_SCHEMA_PATHS,
  );
}

let edits: t.ConfigEditsState;

function Harness({
  scope = false,
  scopeData,
  filter = null,
  showConfiguredOnly = false,
  preset,
  extra,
}: {
  scope?: boolean;
  scopeData?: Partial<t.ResolvedConfigData>;
  filter?: t.PathIndex | null;
  showConfiguredOnly?: boolean;
  preset?: t.FlatConfigMap;
  extra?: t.ConfigRecord;
}) {
  const layers = useMemo(() => layersFor(scope, scopeData, extra), [scope, scopeData, extra]);
  const config = layers.effective ?? {};
  edits = useConfigEdits({
    isEditingScope: scope,
    flatBaseline: flattenObject(config),
    scopeResolvedValues: scope ? flattenObject(config) : null,
    baseActiveConfigValues: config,
    schemaTree: tree,
    schemaPathSet: getSchemaPathSet(),
  });
  const editedValues = preset ?? edits.editedValues;
  const { visibilityEdits } = edits;
  const shown = usePendingConfigValues(layers.effective, editedValues, layers);
  const data = useMemo(
    () => ({
      ...valuesDataFixture(layers, editedValues),
      configValues: shown,
      visibilityEdits,
    }),
    [layers, editedValues, shown, visibilityEdits],
  );
  return (
    <ConfigValuesProvider value={data}>
      <RowFilterContext.Provider value={filter}>
        <McpServersRenderer
          fields={mcpFields}
          parentPath="mcpServers"
          parentValue={config.mcpServers}
          getValue={(path, fallback) => deriveFieldValue(path, fallback, data)}
          onChange={edits.handleFieldChange}
          onDiscardField={edits.handleDiscardField}
          onHideField={edits.handleHideField}
          onUnhideField={edits.handleUnhideField}
          onRenameEntry={edits.handleRenameEntry}
          editedValues={editedValues}
          yamlBaseKeys={new Set(Object.keys(YAML_SERVERS))}
          isEditingScope={scope}
          showConfiguredOnly={showConfiguredOnly}
          editSessionId={edits.editSessionId}
        />
      </RowFilterContext.Provider>
    </ConfigValuesProvider>
  );
}

function card(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-mcp-server="${key}"]`);
  if (!element) throw new Error(`no card for ${key}`);
  return element;
}

function expand(key: string) {
  const toggle = card(key).querySelector<HTMLButtonElement>('button[aria-expanded]');
  if (!toggle) throw new Error('no toggle');
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}

/** Opens a group inside a card (Display, Behavior, …) by its title key. */
function openGroup(key: string, title: string) {
  const button = within(card(key)).getByRole('button', { name: new RegExp(title) });
  if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button);
}

function openMenu(key: string) {
  const trigger = within(card(key)).getByRole('button', {
    name: `com_config_mcp_actions:${key}`,
  });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
}

function menuItem(label: string): HTMLElement {
  return screen.getByRole('menuitem', { name: new RegExp(label) });
}

describe('McpServersRenderer — provenance (MCP-5, MCP-14)', () => {
  it('badges each server by its source and counts the overrides of a YAML server', () => {
    render(<Harness />);
    expect(within(card('github')).getByText('com_config_ui_state_yaml')).toBeInTheDocument();
    expect(within(card('github')).getByText('com_config_mcp_overrides_admin')).toBeInTheDocument();
    expect(within(card('acme')).getByText('com_config_ui_state_added')).toBeInTheDocument();
    expect(within(card('cloudflare')).queryByText('com_config_mcp_overrides_admin')).toBeNull();
  });

  it('names a collapsed server by its title and its key', () => {
    render(<Harness />);
    const header = card('acme').querySelector('button[aria-expanded]')!;
    expect(header).toHaveTextContent('Acme Docs');
    expect(header).toHaveTextContent('acme');
  });

  it('offers Revert to librechat.yaml on an overridden field and marks it pending', () => {
    render(<Harness />);
    expand('github');
    openGroup('github', 'com_config_mcp_group_behavior');
    const revert = within(card('github')).getByRole('button', {
      name: /com_config_values_revert_yaml_aria/,
    });
    fireEvent.click(revert);
    expect(edits.editedValues).toEqual({ 'mcpServers.github.timeout': undefined });
    expect(card('github').querySelector('#mcpServers-github-timeout')).toHaveValue(60000);
  });
});

describe('McpServersRenderer — defaults and locks (MCP-1, MCP-5, MCP-6)', () => {
  it('turning Show in chat menu on and back to Default leaves nothing to save', () => {
    render(<Harness />);
    expand('cloudflare');
    openGroup('cloudflare', 'com_config_mcp_group_display');
    const group = card('cloudflare').querySelector<HTMLElement>('#mcpServers-cloudflare-chatMenu')!;
    fireEvent.click(within(group).getByText('com_config_ctl_on'));
    expect(edits.editedValues).toEqual({ 'mcpServers.cloudflare.chatMenu': true });
    fireEvent.click(within(group).getAllByRole('button')[0]);
    expect(edits.isDirty).toBe(false);
  });

  it('keeps a YAML header key: its value can change, but it has no Delete', () => {
    render(<Harness />);
    expand('github');
    const headers = card('github').querySelector('#mcpServers-github-headers')!;
    expect(
      within(headers as HTMLElement).queryByRole('button', { name: /Authorization/ }),
    ).toBeNull();
  });

  it('shows a stdio server read-only: LibreChat applies no override to it (D10)', () => {
    render(<Harness />);
    expand('everything');
    const everything = card('everything');
    expect(everything.querySelector('input#mcpServers-everything-command')).toBeNull();
    expect(everything.querySelector('#mcpServers-everything-command')).toHaveTextContent('npx');
    expect(everything.querySelector('select#mcpServers-everything-type')).toBeNull();
    expect(within(everything).getByText('com_config_mcp_process_read_only')).toBeInTheDocument();
    expect(everything.querySelector('#mcpServers-everything-url')).toBeNull();
    openGroup('everything', 'com_config_mcp_group_display');
    expect(everything.querySelector('input#mcpServers-everything-title')).toBeNull();
  });

  it('locks the transport of a YAML server and shows an http type as written', () => {
    render(<Harness />);
    expand('github');
    expect(card('github').querySelector('select#mcpServers-github-type')).toBeNull();
    expect(card('github').querySelector('#mcpServers-github-type')).toHaveTextContent(
      'com_config_mcp_transport_http',
    );
  });

  it('offers the URL of a server that names no transport', () => {
    render(<Harness extra={{ bare: { title: 'Bare' } }} />);
    expand('bare');
    expect(card('bare').querySelector('input#mcpServers-bare-url')).not.toBeNull();
  });

  it('hides fields the transport does not read (no Working directory on HTTP)', () => {
    render(<Harness />);
    expand('acme');
    expect(card('acme').querySelector('#mcpServers-acme-cwd')).toBeNull();
    expect(card('acme').querySelector('#mcpServers-acme-command')).toBeNull();
  });
});

describe('McpServersRenderer — create (MCP-9)', () => {
  it('creates a Streamable HTTP server with a header', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /com_config_create_mcp_server/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(
      within(dialog).getByPlaceholderText('com_config_mcp_create_name_placeholder'),
      {
        target: { value: 'srv-a' },
      },
    );
    const url = dialog.querySelector<HTMLInputElement>('#mcpDraft-url input, input#mcpDraft-url');
    if (!url) throw new Error('no URL input');
    fireEvent.change(url, { target: { value: 'https://mcp.example.com/mcp' } });
    fireEvent.blur(url);
    const headers = dialog.querySelector<HTMLElement>('#mcpDraft-headers');
    if (!headers) throw new Error('no headers editor');
    fireEvent.click(within(headers).getByRole('button', { name: /com_ui_add_item/ }));
    const key = within(headers).getByRole('textbox', { name: 'com_ui_key 1' });
    fireEvent.change(key, { target: { value: 'X-Org' } });
    fireEvent.blur(key);
    const value = within(headers)
      .getAllByRole('textbox')
      .find((input) => input !== key);
    if (!value) throw new Error('no value input');
    fireEvent.change(value, { target: { value: 'acme' } });
    fireEvent.blur(value);
    expect(within(dialog).queryByText('must be an object')).not.toBeInTheDocument();
    const create = within(dialog).getByRole('button', { name: 'com_ui_create' });
    expect(create).toBeEnabled();
    await act(async () => {
      fireEvent.click(create);
    });
    expect(edits.editedValues).toMatchObject({
      'mcpServers.srv-a.type': 'streamable-http',
      'mcpServers.srv-a.url': 'https://mcp.example.com/mcp',
      'mcpServers.srv-a.headers.X-Org': 'acme',
    });
  });
});

describe('McpServersRenderer — create explains an unparsable URL (MCP-9)', () => {
  it('marks the URL invalid with a message instead of only disabling Create', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /com_config_create_mcp_server/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(
      within(dialog).getByPlaceholderText('com_config_mcp_create_name_placeholder'),
      { target: { value: 'srv-u' } },
    );
    const url = dialog.querySelector<HTMLInputElement>('#mcpDraft-url input, input#mcpDraft-url');
    if (!url) throw new Error('no URL input');
    fireEvent.change(url, { target: { value: 'not a url' } });
    fireEvent.blur(url);
    expect(within(dialog).getByRole('button', { name: 'com_ui_create' })).toBeDisabled();
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(url).toHaveAccessibleDescription(expect.stringContaining('must be a valid URL'));
    fireEvent.change(url, { target: { value: 'https://mcp.example.com/u' } });
    fireEvent.blur(url);
    expect(url).not.toHaveAttribute('aria-invalid');
    expect(within(dialog).getByRole('button', { name: 'com_ui_create' })).toBeEnabled();
  });
});

describe('McpServersRenderer — create validates header rows (MCP-9)', () => {
  async function openFilledDialog() {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /com_config_create_mcp_server/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(
      within(dialog).getByPlaceholderText('com_config_mcp_create_name_placeholder'),
      { target: { value: 'srv-d' } },
    );
    const url = dialog.querySelector<HTMLInputElement>('#mcpDraft-url input, input#mcpDraft-url');
    if (!url) throw new Error('no URL input');
    fireEvent.change(url, { target: { value: 'https://mcp.example.com/c' } });
    fireEvent.blur(url);
    const headers = dialog.querySelector<HTMLElement>('#mcpDraft-headers');
    if (!headers) throw new Error('no headers editor');
    return { dialog, headers };
  }

  function typeRow(headers: HTMLElement, n: number, key: string, value = 'v') {
    fireEvent.click(within(headers).getByRole('button', { name: /com_ui_add_item/ }));
    const input = within(headers).getByRole('textbox', { name: `com_ui_key ${n}` });
    fireEvent.change(input, { target: { value: key } });
    fireEvent.blur(input);
    const valueInput = within(headers).getByRole('textbox', { name: `com_ui_value ${n}` });
    fireEvent.change(valueInput, { target: { value } });
    fireEvent.blur(valueInput);
  }

  it.each([
    ['a blank key', '   '],
    ['a repeated key', 'X-Good'],
    ['a dotted key', 'X.Bad'],
  ])('keeps Create disabled and names the rows to fix for %s', async (_case, key) => {
    const { dialog, headers } = await openFilledDialog();
    typeRow(headers, 1, 'X-Good');
    const create = within(dialog).getByRole('button', { name: 'com_ui_create' });
    expect(create).toBeEnabled();
    typeRow(headers, 2, key);
    expect(create).toBeDisabled();
    expect(within(dialog).getByText(/com_config_mcp_create_fix_rows/)).toBeInTheDocument();
    fireEvent.click(
      within(headers)
        .getAllByRole('button', { name: /com_ui_delete/ })
        .at(-1)!,
    );
    expect(create).toBeEnabled();
  });

  it('a header with a key but no value is still needed, not silently left out', async () => {
    const { dialog, headers } = await openFilledDialog();
    typeRow(headers, 1, 'X-Org', '');
    expect(within(dialog).getByRole('button', { name: 'com_ui_create' })).toBeDisabled();
    expect(within(dialog).getByText(/com_config_mcp_create_missing/)).toBeInTheDocument();
  });

  it('Enter in a header key commits the row instead of creating the server', async () => {
    const { headers } = await openFilledDialog();
    fireEvent.click(within(headers).getByRole('button', { name: /com_ui_add_item/ }));
    const input = within(headers).getByRole('textbox', { name: 'com_ui_key 1' });
    fireEvent.change(input, { target: { value: 'X-Good' } });
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(edits.editedValues).toEqual({});
  });
});

describe('McpServersRenderer — transport and auth switches (MCP-2, MCP-4)', () => {
  it('asks before a switch removes saved fields, then removes them', () => {
    render(<Harness />);
    expand('acme');
    fireEvent.change(card('acme').querySelector('select#mcpServers-acme-type')!, {
      target: { value: 'websocket' },
    });
    expect(edits.editedValues).toEqual({});
    fireEvent.click(
      within(card('acme')).getByRole('button', { name: 'com_config_mcp_transport_switch_confirm' }),
    );
    expect(edits.editedValues).toEqual({
      'mcpServers.acme.headers': undefined,
      'mcpServers.acme.type': 'websocket',
    });
  });

  it('drops a waiting transport switch when the edit session ends, and plans it from the current entry', () => {
    render(<Harness />);
    expand('acme');
    const select = () =>
      card('acme').querySelector<HTMLSelectElement>('select#mcpServers-acme-type')!;
    const confirm = () =>
      within(card('acme')).queryByRole('button', {
        name: 'com_config_mcp_transport_switch_confirm',
      });
    fireEvent.change(select(), { target: { value: 'websocket' } });
    expect(confirm()).toBeInTheDocument();
    act(() => edits.handleDiscard());
    expect(confirm()).toBeNull();
    expect(select().value).toBe('streamable-http');

    fireEvent.change(select(), { target: { value: 'websocket' } });
    act(() => edits.handleFieldChange('mcpServers.acme.timeout', 30000));
    act(() => edits.handleFieldChange('mcpServers.acme.proxy', 'http://proxy:8080'));
    fireEvent.click(confirm()!);
    expect(edits.editedValues).toEqual({
      'mcpServers.acme.timeout': 30000,
      'mcpServers.acme.headers': undefined,
      'mcpServers.acme.type': 'websocket',
    });
  });

  it('starts an API key as the admin Bearer key, with a masked key input', () => {
    render(<Harness />);
    expand('acme');
    openGroup('acme', 'com_config_mcp_group_auth');
    fireEvent.click(within(card('acme')).getByText('com_config_mcp_auth_api_key'));
    expect(edits.editedValues).toEqual({
      'mcpServers.acme.apiKey.source': 'admin',
      'mcpServers.acme.apiKey.authorization_type': 'bearer',
    });
    const key = card('acme').querySelector<HTMLInputElement>(
      '#mcpServers-acme-apiKey-key input, input#mcpServers-acme-apiKey-key',
    );
    expect(key?.type).toBe('password');
  });
});

describe('McpServersRenderer — stored secrets', () => {
  it('shows a stored OAuth client secret as its masked preview, with Replace and Cancel', () => {
    const vault: t.ConfigRecord = {
      vault: {
        type: 'streamable-http',
        url: 'https://mcp.vault.dev/mcp',
        oauth: { client_id: 'vault-id', client_secretPreview: 'sec...1234' },
      },
    };
    render(<Harness extra={vault} />);
    expand('vault');
    openGroup('vault', 'com_config_mcp_group_auth');
    const masked = within(card('vault')).getByLabelText(
      /com_a11y_secret_configured:.*client_secret/,
    ) as HTMLInputElement;
    expect(masked.value).toBe('sec...1234');
    fireEvent.click(
      within(card('vault')).getByRole('button', {
        name: /com_a11y_secret_replace:.*client_secret/,
      }),
    );
    const input = card('vault').querySelector<HTMLInputElement>(
      'input#mcpServers-vault-oauth-client_secret',
    );
    expect(input?.type).toBe('password');
    fireEvent.change(input as HTMLInputElement, { target: { value: 'new-secret' } });
    act(() => edits.handleFieldChange('mcpServers.vault.oauth.client_secret', 'new-secret'));
    fireEvent.click(
      within(card('vault')).getByRole('button', {
        name: /com_a11y_secret_cancel_replace:.*client_secret/,
      }),
    );
    expect(edits.editedValues).toEqual({});
    expect(
      within(card('vault')).getByLabelText(/com_a11y_secret_configured:.*client_secret/),
    ).toBeInTheDocument();
  });
});

describe('McpServersRenderer — delete, undo and rename (MCP-12, D9)', () => {
  it('deletes a server the panel added from its menu, with Undo until Save', async () => {
    render(<Harness />);
    openMenu('acme');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_delete'));
    });
    expect(edits.editedValues).toEqual({ 'mcpServers.acme': undefined });
    const ghost = document.querySelector('[data-mcp-deleted="acme"]') as HTMLElement;
    expect(ghost).toBeInTheDocument();
    fireEvent.click(within(ghost).getByRole('button'));
    expect(edits.editedValues).toEqual({});
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(document.activeElement).toBe(
      within(card('acme')).getByRole('button', { name: 'Acme Docs (acme)' }),
    );
  });

  it('keeps a deletion listed when it comes back from outside the card (Discard → Undo)', () => {
    render(<Harness preset={{ 'mcpServers.acme': undefined }} />);
    expect(document.querySelector('[data-mcp-deleted="acme"]')).toBeInTheDocument();
  });

  it('cannot rename or delete a server librechat.yaml defines (D1)', () => {
    render(<Harness />);
    openMenu('github');
    expect(menuItem('com_config_mcp_action_delete')).toHaveAttribute('aria-disabled', 'true');
    expect(menuItem('com_config_mcp_action_rename')).toHaveAttribute('aria-disabled', 'true');
  });

  it('renames a server as its fields under the new name plus removal of the old one', async () => {
    render(<Harness />);
    openMenu('acme');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_rename'));
    });
    const input = screen.getByRole('textbox', { name: 'com_a11y_rename_entry:acme' });
    fireEvent.change(input, { target: { value: 'acme-docs' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(edits.editedValues).toMatchObject({
      'mcpServers.acme': undefined,
      'mcpServers.acme-docs.url': 'https://mcp.acme.dev/mcp',
      'mcpServers.acme-docs.title': 'Acme Docs',
      'mcpServers.acme-docs.headers.X-Team': 'docs',
    });
    expect(document.querySelector('[data-mcp-deleted="acme"]')).toBeNull();
    expect(
      within(card('acme-docs')).getByText('com_config_mcp_renamed_from:acme'),
    ).toBeInTheDocument();
    expect(edits.renameEdits).toEqual({ 'mcpServers.acme-docs': 'mcpServers.acme' });
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    openMenu('acme-docs');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_rename'));
    });
    const again = screen.getByRole('textbox', { name: 'com_a11y_rename_entry:acme-docs' });
    fireEvent.change(again, { target: { value: 'acme-kb' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    expect(edits.renameEdits).toEqual({ 'mcpServers.acme-kb': 'mcpServers.acme' });
  });

  it('lists a renamed server deleted before Save under its saved name, with Undo back to the rename', async () => {
    render(<Harness />);
    openMenu('acme');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_rename'));
    });
    const input = screen.getByRole('textbox', { name: 'com_a11y_rename_entry:acme' });
    fireEvent.change(input, { target: { value: 'acme-docs' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const renamed = { ...edits.editedValues };
    openMenu('acme-docs');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_delete'));
    });
    expect(edits.editedValues).toEqual({ 'mcpServers.acme': undefined });
    expect(document.querySelector('[data-mcp-server="acme-docs"]')).toBeNull();
    const ghost = document.querySelector('[data-mcp-deleted="acme"]') as HTMLElement;
    expect(ghost).toBeInTheDocument();
    fireEvent.click(within(ghost).getByRole('button'));
    expect(edits.editedValues).toEqual(renamed);
    expect(document.querySelector('[data-mcp-deleted="acme"]')).toBeNull();
    expect(
      within(card('acme-docs')).getByText('com_config_mcp_renamed_from:acme'),
    ).toBeInTheDocument();
  });

  it('asks for a stored OAuth client secret again when a saved server is renamed', async () => {
    const vault: t.ConfigRecord = {
      vault: {
        type: 'streamable-http',
        url: 'https://mcp.vault.dev/mcp',
        oauth: { client_id: 'vault-id', client_secretPreview: 'sec...1234' },
      },
    };
    render(<Harness extra={vault} />);
    openMenu('vault');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_rename'));
    });
    const input = screen.getByRole('textbox', { name: 'com_a11y_rename_entry:vault' });
    fireEvent.change(input, { target: { value: 'vault-kb' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(edits.editedValues).not.toHaveProperty('mcpServers.vault-kb.oauth.client_secretPreview');
    expect(
      within(card('vault-kb')).getByText('com_config_mcp_duplicate_secrets'),
    ).toBeInTheDocument();
    act(() => edits.handleFieldChange('mcpServers.vault-kb.oauth.client_secret', 'new-secret'));
    expect(within(card('vault-kb')).queryByText('com_config_mcp_duplicate_secrets')).toBeNull();
  });

  it('stops asking for a stored secret once the renamed server no longer uses that authentication', async () => {
    const vault: t.ConfigRecord = {
      vault: {
        type: 'streamable-http',
        url: 'https://mcp.vault.dev/mcp',
        oauth: { client_id: 'vault-id', client_secretPreview: 'sec...1234' },
      },
    };
    render(<Harness extra={vault} />);
    openMenu('vault');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_rename'));
    });
    const input = screen.getByRole('textbox', { name: 'com_a11y_rename_entry:vault' });
    fireEvent.change(input, { target: { value: 'vault-kb' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(
      within(card('vault-kb')).getByText('com_config_mcp_duplicate_secrets'),
    ).toBeInTheDocument();
    act(() => edits.handleDiscardField('mcpServers.vault-kb.oauth.client_id'));
    expect(within(card('vault-kb')).queryByText('com_config_mcp_duplicate_secrets')).toBeNull();
  });

  it('drops the rename record when the renamed server is deleted, and brings it back with Undo', async () => {
    render(<Harness />);
    openMenu('acme');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_rename'));
    });
    const input = screen.getByRole('textbox', { name: 'com_a11y_rename_entry:acme' });
    fireEvent.change(input, { target: { value: 'acme-docs' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(edits.renameEdits).toEqual({ 'mcpServers.acme-docs': 'mcpServers.acme' });
    openMenu('acme-docs');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_delete'));
    });
    expect(edits.renameEdits).toEqual({});
    const ghost = document.querySelector('[data-mcp-deleted="acme"]') as HTMLElement;
    fireEvent.click(within(ghost).getByRole('button'));
    expect(edits.renameEdits).toEqual({ 'mcpServers.acme-docs': 'mcpServers.acme' });
  });

  it('forgets the Undo of a deleted rename once the edit session ends', async () => {
    render(<Harness />);
    openMenu('acme');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_rename'));
    });
    const input = screen.getByRole('textbox', { name: 'com_a11y_rename_entry:acme' });
    fireEvent.change(input, { target: { value: 'acme-docs' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    openMenu('acme-docs');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_delete'));
    });
    act(() => edits.handleDiscard());
    expect(edits.editedValues).toEqual({});
    openMenu('acme');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_delete'));
    });
    const ghost = document.querySelector('[data-mcp-deleted="acme"]') as HTMLElement;
    fireEvent.click(within(ghost).getByRole('button'));
    expect(edits.editedValues).toEqual({});
    expect(edits.renameEdits).toEqual({});
    act(() => edits.handleFieldChange('mcpServers.acme-docs.url', 'https://other.dev/mcp'));
    expect(document.querySelector('[data-mcp-server="acme-docs"]')).toBeInTheDocument();
    expect(within(card('acme-docs')).queryByText('com_config_mcp_renamed_from:acme')).toBeNull();
  });

  it('forgets a rename the change review reverted, so a new server of that name is not it', async () => {
    render(<Harness />);
    openMenu('acme');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_rename'));
    });
    const input = screen.getByRole('textbox', { name: 'com_a11y_rename_entry:acme' });
    fireEvent.change(input, { target: { value: 'acme-docs' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    act(() => {
      for (const path of Object.keys(edits.editedValues)) edits.handleDiscardField(path);
      edits.handleRenameEntry('mcpServers.acme-docs', null);
    });
    act(() => edits.handleFieldChange('mcpServers.acme-docs.url', 'https://other.dev/mcp'));
    expect(within(card('acme-docs')).queryByText('com_config_mcp_renamed_from:acme')).toBeNull();
    openMenu('acme');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_delete'));
    });
    expect(document.querySelector('[data-mcp-deleted="acme"]')).toBeInTheDocument();
  });

  it('rejects a rename onto an existing name and keeps the input open', async () => {
    render(<Harness />);
    openMenu('acme');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_rename'));
    });
    const input = screen.getByRole('textbox', { name: 'com_a11y_rename_entry:acme' });
    fireEvent.change(input, { target: { value: 'github' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_server_name_exists');
    expect(edits.editedValues).toEqual({});
  });

  it('duplicates a server without the masked preview of its stored key, asking for the key again', async () => {
    const vault: t.ConfigRecord = {
      vault: {
        type: 'streamable-http',
        url: 'https://mcp.vault.dev/mcp',
        apiKey: { source: 'admin', authorization_type: 'bearer', keyPreview: '...4321' },
      },
    };
    render(<Harness extra={vault} />);
    openMenu('vault');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_duplicate'));
    });
    expect(edits.editedValues).toEqual({
      'mcpServers.vault-copy.type': 'streamable-http',
      'mcpServers.vault-copy.url': 'https://mcp.vault.dev/mcp',
      'mcpServers.vault-copy.apiKey.source': 'admin',
      'mcpServers.vault-copy.apiKey.authorization_type': 'bearer',
    });
    expect(
      within(card('vault-copy')).getByText('com_config_mcp_duplicate_secrets'),
    ).toBeInTheDocument();
    expect(within(card('vault')).queryByText('com_config_mcp_duplicate_secrets')).toBeNull();
    act(() => edits.handleFieldChange('mcpServers.vault-copy.apiKey.key', 'sk-new-key'));
    expect(within(card('vault-copy')).queryByText('com_config_mcp_duplicate_secrets')).toBeNull();
  });

  it('duplicates a server under a free name', async () => {
    render(<Harness />);
    openMenu('acme');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_duplicate'));
    });
    expect(edits.editedValues).toMatchObject({
      'mcpServers.acme-copy.url': 'https://mcp.acme.dev/mcp',
      'mcpServers.acme-copy.title': 'Acme Docs copy',
    });
  });
});

describe('McpServersRenderer — profiles (MCP-10)', () => {
  it('lists every inherited server read-only until its fields are overridden', () => {
    render(<Harness scope />);
    for (const key of ['github', 'everything', 'cloudflare', 'acme']) {
      expect(within(card(key)).getByText('com_config_values_source_inherited')).toBeInTheDocument();
    }
    expand('cloudflare');
    expect(card('cloudflare').querySelector('input#mcpServers-cloudflare-url')).toBeNull();
    fireEvent.click(
      within(card('cloudflare')).getByRole('button', { name: 'com_config_mcp_override_fields' }),
    );
    expect(card('cloudflare').querySelector('input#mcpServers-cloudflare-url')).not.toBeNull();
  });

  it('hides a server Base added for the profile, but not a librechat.yaml one', async () => {
    render(<Harness scope />);
    openMenu('github');
    expect(menuItem('com_config_mcp_action_hide')).toHaveAttribute('aria-disabled', 'true');
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });
    openMenu('acme');
    await act(async () => {
      fireEvent.click(menuItem('com_config_mcp_action_hide'));
    });
    expect(edits.visibilityEdits).toEqual({ 'mcpServers.acme': 'hide' });
  });

  it('lists a server the profile hides, with Unhide', () => {
    render(<Harness scope scopeData={{ tombstones: ['mcpServers.acme'] }} />);
    const row = document.querySelector('[data-mcp-hidden="acme"]') as HTMLElement;
    expect(row).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'com_config_mcp_unhide_a11y:acme' }));
    expect(edits.visibilityEdits).toEqual({ 'mcpServers.acme': 'unhide' });
    expect(document.querySelector('[data-mcp-hidden="acme"]')).toBeNull();
    expect(within(card('acme')).getByText('com_config_ui_state_edited')).toBeInTheDocument();
  });

  it('with "Set values only", lists only the servers the profile changes', () => {
    render(
      <Harness
        scope
        showConfiguredOnly
        scopeData={{ overrides: { mcpServers: { github: { timeout: 1000 } } } }}
      />,
    );
    expect(card('github')).toBeInTheDocument();
    expect(document.querySelector('[data-mcp-server="cloudflare"]')).toBeNull();
  });
});

describe('McpServersRenderer — overriding under "Set values only"', () => {
  it('keeps an inherited server listed once Create chooses to override it', async () => {
    render(<Harness scope showConfiguredOnly />);
    expect(document.querySelector('[data-mcp-server="cloudflare"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'com_config_create_mcp_server' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(
      within(dialog).getByPlaceholderText('com_config_mcp_create_name_placeholder'),
      {
        target: { value: 'cloudflare' },
      },
    );
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'com_config_mcp_create_override:cloudflare' }),
      );
    });
    expect(card('cloudflare').querySelector('input#mcpServers-cloudflare-url')).not.toBeNull();
  });
});

describe('McpServersRenderer — legacy dotted names', () => {
  it('shows a dotted server read-only, without actions (the admin API drops dotted keys)', () => {
    render(
      <Harness extra={{ 'legacy.dotted': { type: 'sse', url: 'https://old.example.com' } }} />,
    );
    const dotted = card('legacy.dotted');
    expect(within(dotted).queryByRole('button', { name: /com_config_mcp_actions/ })).toBeNull();
    expand('legacy.dotted');
    expect(within(dotted).getByText('com_config_mcp_dotted_name')).toBeInTheDocument();
    expect(dotted.querySelector('input#mcpServers-legacy-dotted-url')).toBeNull();
    expect(dotted.querySelector('#mcpServers-legacy-dotted-url')).toHaveTextContent(
      'https://old.example.com',
    );
  });
});

describe('McpServersRenderer — Set values only (MCP-11)', () => {
  it('shows only the fields and groups of a server that hold a value', () => {
    render(<Harness showConfiguredOnly />);
    expand('cloudflare');
    const cloudflare = card('cloudflare');
    expect(cloudflare.querySelector('#mcpServers-cloudflare-url')).not.toBeNull();
    expect(cloudflare.querySelector('#mcpServers-cloudflare-headers')).toBeNull();
    expect(within(cloudflare).queryByText('com_config_mcp_group_display')).toBeNull();
    expect(within(cloudflare).queryByText('com_config_mcp_group_advanced')).toBeNull();
  });
});

describe('McpServersRenderer — tab filter', () => {
  it('lists only the servers the filter matches', () => {
    render(<Harness filter={createPathIndex(['mcpServers.cloudflare.url'])} />);
    expect(document.querySelector('[data-mcp-server="github"]')).toBeNull();
    expect(card('cloudflare')).toBeInTheDocument();
  });
});
