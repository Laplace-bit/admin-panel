import { configSchema } from 'librechat-data-provider';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { ProvidersRenderer } from '../ProvidersRenderer';
import { extractSchemaTree } from '@/server/config';
import { getValueAtPath } from '@/utils';

vi.mock('@/hooks/useLocalize', () => {
  const localize = (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key;
  return { default: () => localize, useLocalize: () => localize };
});

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const endpointFields = tree.find((field) => field.key === 'endpoints')?.children ?? [];

const CONFIG: t.ConfigRecord = {
  endpoints: {
    all: { activityModel: 'gpt-5.6-luna' },
    openAI: { titleModel: 'gpt-5-mini', activityModel: 'gpt-x' },
    agents: { recursionLimit: 50, capabilities: ['tools', 'web_search'] },
    azureOpenAI: {
      groups: [
        {
          group: 'eastus',
          apiKey: '${EASTUS_API_KEY}',
          instanceName: 'librechat-eastus',
          version: '2024-02-15-preview',
          models: { 'gpt-4.1': { deploymentName: 'gpt-41' }, 'gpt-4o': true },
          serverless: false,
          assistants: true,
        },
        { group: 'foundry', apiKey: 'sk-literal', baseURL: 'https://f/models', serverless: true },
      ],
    },
  },
};

const CONFIGURED = new Set([
  'endpoints.all.activityModel',
  'endpoints.openAI.titleModel',
  'endpoints.openAI.activityModel',
  'endpoints.agents.recursionLimit',
  'endpoints.agents.capabilities',
  'endpoints.azureOpenAI.groups',
]);

const STATUS: t.EndpointStatusMap = {
  openAI: { name: 'openAI', custom: false, userProvide: false },
  agents: { name: 'agents', custom: false, userProvide: false },
};

function renderProviders(overrides: Partial<t.FieldRendererProps> = {}) {
  const client = new QueryClient();
  client.setQueryData(['endpointStatus', 0], STATUS);
  client.setQueryData(['endpointModels', 0], { openAI: ['gpt-5-mini', 'gpt-5'] });
  const onChange = vi.fn();
  const values: t.ConfigValuesData = { configValues: CONFIG, editedValues: {} };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ConfigValuesProvider value={values}>{children}</ConfigValuesProvider>
    </QueryClientProvider>
  );
  const utils = render(
    <ProvidersRenderer
      fields={endpointFields}
      parentPath="endpoints"
      parentValue={CONFIG.endpoints}
      getValue={(path, fallback) => fallback ?? getValueAtPath(CONFIG, path)}
      onChange={onChange}
      configuredPaths={CONFIGURED}
      editedValues={{}}
      {...overrides}
    />,
    { wrapper },
  );
  return { ...utils, onChange };
}

const card = (key: string) => document.getElementById(`section-endpoints.${key}`) as HTMLElement;
const trigger = (key: string) =>
  card(key).querySelector('.settings-section-trigger') as HTMLButtonElement;

beforeEach(() => {
  localStorage.clear();
});

describe('ProvidersRenderer', () => {
  it('pins Global overrides first and Network access last, all collapsed', () => {
    renderProviders();
    const ids = [...document.querySelectorAll('section[data-settings-section]')].map((s) => s.id);
    expect(ids[0]).toBe('section-endpoints.all');
    expect(ids[ids.length - 1]).toBe('section-endpoints.allowedAddresses');
    expect(ids).not.toContain('section-endpoints.custom');
    for (const button of document.querySelectorAll('.settings-section-trigger')) {
      expect(button.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('shows Active / Not enabled from /api/endpoints in provider headers', () => {
    renderProviders();
    expect(within(card('openAI')).getByText('com_config_providers_status_active')).toBeTruthy();
    expect(within(card('google')).getByText('com_config_providers_status_disabled')).toBeTruthy();
    expect(within(card('all')).queryByText(/com_config_providers_status_/)).toBeNull();
  });

  it('summarizes a collapsed card, flagging values Global takes precedence over', () => {
    renderProviders();
    const summary = card('openAI').querySelector('.settings-help') as HTMLElement;
    expect(summary.textContent).toContain('gpt-5-mini');
    expect(summary.textContent).toContain('com_config_providers_summary_shadowed');
  });

  it('remembers which provider was open across remounts (AP-8)', () => {
    const first = renderProviders();
    fireEvent.click(trigger('openAI'));
    expect(trigger('openAI')).toHaveAttribute('aria-expanded', 'true');
    first.unmount();
    renderProviders();
    expect(trigger('openAI')).toHaveAttribute('aria-expanded', 'true');
    expect(trigger('anthropic')).toHaveAttribute('aria-expanded', 'false');
  });

  it("explains in a provider's title group that Global settings win (D11)", () => {
    renderProviders();
    fireEvent.click(trigger('openAI'));
    const titles = document.getElementById('section-endpoints.openAI-titles') as HTMLElement;
    expect(within(titles).getByText(/com_config_providers_global_titles_banner/)).toBeTruthy();
    expect(within(titles).getByText('com_config_providers_summary_ignored')).toBeTruthy();
  });

  it('opens Agent features first, with capability descriptions and paired limits', () => {
    renderProviders();
    fireEvent.click(trigger('agents'));
    const features = document.getElementById('section-endpoints.agents-features') as HTMLElement;
    expect(features.querySelector('[aria-expanded="true"]')).toBeTruthy();
    expect(within(features).getByText('Web search')).toBeTruthy();
    expect(within(features).getByText('com_config_providers_cap_web_search_desc')).toBeTruthy();
    expect(features.querySelectorAll('.provider-pair')).toHaveLength(2);
    const citations = document.getElementById('section-endpoints.agents-citations') as HTMLElement;
    expect(citations.querySelector('[aria-expanded="false"]')).toBeTruthy();
  });

  it('says when the max recursion limit caps the recursion limit', () => {
    const limits = {
      ...CONFIG,
      endpoints: { agents: { recursionLimit: 75, maxRecursionLimit: 60 } },
    };
    renderProviders({ getValue: (path, fallback) => fallback ?? getValueAtPath(limits, path) });
    fireEvent.click(trigger('agents'));
    const features = document.getElementById('section-endpoints.agents-features') as HTMLElement;
    expect(
      within(features).getByText('com_config_providers_recursion_capped:{"max":60,"limit":75}'),
    ).toBeTruthy();
  });

  it('shows Azure groups read-only, with a drawer that never shows a key', () => {
    renderProviders();
    fireEvent.click(trigger('azureOpenAI'));
    const azure = card('azureOpenAI');
    expect(within(azure).getByText('com_config_providers_azure_readonly')).toBeTruthy();
    expect(within(azure).getByText('com_config_providers_groups:{"count":2}')).toBeTruthy();
    fireEvent.click(
      within(azure).getByRole('button', {
        name: 'com_config_providers_azure_details_aria:{"group":"foundry"}',
      }),
    );
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('com_config_providers_azure_masked')).toBeTruthy();
    expect(drawer.textContent).not.toContain('sk-literal');
    fireEvent.click(
      within(drawer).getByRole('button', { name: 'com_config_providers_azure_close' }),
    );
    fireEvent.click(
      within(azure).getByRole('button', {
        name: 'com_config_providers_azure_details_aria:{"group":"eastus"}',
      }),
    );
    const eastus = screen.getByRole('dialog');
    expect(within(eastus).getByText(/EASTUS_API_KEY/)).toBeTruthy();
    expect(within(eastus).getByText('gpt-4.1')).toBeTruthy();
  });

  it('validates network addresses as they are typed and saves valid ones', () => {
    const { onChange } = renderProviders();
    fireEvent.click(trigger('allowedAddresses'));
    const network = card('allowedAddresses');
    fireEvent.click(within(network).getByRole('button', { name: /com_ui_add_item/ }));
    const input = within(network).getByPlaceholderText('com_config_providers_network_placeholder');
    fireEvent.change(input, { target: { value: 'localhost' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(network).getByRole('alert').textContent).toBe(
      'com_config_providers_network_issue_port',
    );
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'localhost:11434' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('endpoints.allowedAddresses', ['localhost:11434']);
  });

  it('hides providers with nothing set when only set values are shown', () => {
    renderProviders({ showConfiguredOnly: true });
    expect(card('openAI')).toBeTruthy();
    expect(card('google')).toBeNull();
    expect(card('allowedAddresses')).toBeNull();
  });

  it('keeps configured Azure groups and their table when only set values are shown', () => {
    renderProviders({ showConfiguredOnly: true });
    fireEvent.click(trigger('azureOpenAI'));
    const groups = document.getElementById('section-endpoints.azureOpenAI-groups') as HTMLElement;
    expect(groups).toBeTruthy();
    expect(within(groups).getByText('com_config_providers_azure_readonly')).toBeTruthy();
    expect(
      within(groups).getByRole('button', {
        name: 'com_config_providers_azure_details_aria:{"group":"eastus"}',
      }),
    ).toBeTruthy();
    expect(document.getElementById('endpoints-azureOpenAI-groups')).toHaveClass('azure-groups');
  });

  it('keeps unsaved values of unset settings reachable when only set values are shown', () => {
    const edits: t.FlatConfigMap = {
      'endpoints.openAI.streamRate': 50,
      'endpoints.openAI.titleMethod': 'structured',
      'endpoints.google.titleModel': 'gemini-x',
    };
    renderProviders({
      showConfiguredOnly: true,
      editedValues: edits,
      getValue: (path, fallback) =>
        path in edits ? edits[path] : (fallback ?? getValueAtPath(CONFIG, path)),
    });
    expect(card('google')).toBeTruthy();
    fireEvent.click(trigger('openAI'));
    const streaming = document.getElementById('section-endpoints.openAI-streaming') as HTMLElement;
    expect(streaming).toBeTruthy();
    expect(document.getElementById('section-endpoints.openAI-reasoning')).toBeNull();
    fireEvent.click(streaming.querySelector('.settings-trigger') as HTMLButtonElement);
    expect(document.getElementById('endpoints-openAI-streamRate')).toBeTruthy();
    expect(document.getElementById('endpoints-openAI-maxToolResultChars')).toBeNull();
    const titles = document.getElementById('section-endpoints.openAI-titles') as HTMLElement;
    fireEvent.click(titles.querySelector('.settings-trigger') as HTMLButtonElement);
    expect(within(titles).getByText('Structured', { exact: false })).toBeTruthy();
    expect(document.getElementById('endpoints-openAI-titleModel')).toBeTruthy();
    expect(document.getElementById('endpoints-openAI-titlePrompt')).toBeNull();
  });
});
