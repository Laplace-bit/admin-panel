import { describe, it, expect, vi } from 'vitest';
import { configSchema } from 'librechat-data-provider';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  baseConfigFixture,
  baseLayersFixture,
  scopeLayersFixture,
  valuesDataFixture,
} from '@/test/layers';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { ModelSpecsRenderer } from '../ModelSpecsRenderer';
import { extractSchemaTree } from '@/server/config';
import { previewText } from '../SpecsSettings';
import { slugify } from '../SpecFields';
import { withDefault } from '../SpecList';

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
  useLocalize: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const specFields = tree.find((field) => field.key === 'modelSpecs')?.children ?? [];

const SPECS: t.ConfigRecord[] = [
  {
    name: 'gpt',
    label: 'GPT',
    default: true,
    preset: { endpoint: 'openAI', model: 'gpt-4o' },
  },
  {
    name: 'claude',
    label: 'Claude',
    showInMenu: false,
    preset: { endpoint: 'anthropic', model: 'claude-sonnet-4-5' },
  },
];

function renderSpecs(
  modelSpecs: t.ConfigRecord,
  {
    onChange = vi.fn(),
    data,
    showConfiguredOnly,
  }: {
    onChange?: t.FieldRendererProps['onChange'];
    data?: t.ConfigValuesData;
    showConfiguredOnly?: boolean;
  } = {},
) {
  const values = data ?? valuesDataFixture(baseLayersFixture());
  const wrap = (children: ReactNode) => (
    <ConfigValuesProvider
      value={{ ...values, configValues: { ...values.configValues, modelSpecs } }}
    >
      {children}
    </ConfigValuesProvider>
  );
  const ui = (
    <ModelSpecsRenderer
      fields={specFields}
      parentPath="modelSpecs"
      parentValue={modelSpecs}
      getValue={(path, fallback) => {
        const key = path.slice('modelSpecs.'.length);
        return key in modelSpecs ? modelSpecs[key] : fallback;
      }}
      onChange={onChange}
      onResetField={vi.fn()}
      onDiscardField={vi.fn()}
      permissions={{ canView: true, canEdit: true, canAssign: true }}
      showConfiguredOnly={showConfiguredOnly}
    />
  );
  return { onChange, ...render(wrap(ui)) };
}

describe('ModelSpecsRenderer', () => {
  it('lists each spec by label with its badges and endpoint · model', () => {
    renderSpecs({ list: SPECS });
    const cards = document.querySelectorAll('[data-entry-card]');
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText('GPT')).toBeInTheDocument();
    expect(
      within(cards[0] as HTMLElement).getByText('com_config_specs_badge_default'),
    ).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText('gpt · openAI · gpt-4o')).toBeInTheDocument();
    expect(
      within(cards[1] as HTMLElement).getByText('com_config_specs_badge_hidden'),
    ).toBeInTheDocument();
  });

  it('opens a new spec with Endpoint and Model up front, marked required', () => {
    const { onChange } = renderSpecs({ list: SPECS });
    fireEvent.click(screen.getByRole('button', { name: 'com_config_specs_add' }));
    expect(onChange).toHaveBeenCalledWith('modelSpecs.list', [...SPECS, {}]);
  });

  it('shows the endpoint as a choice of configured endpoints and the model as text', () => {
    renderSpecs({ list: SPECS });
    const toggle = document.querySelectorAll<HTMLButtonElement>(
      '[data-entry-card] button[aria-expanded]',
    )[0];
    fireEvent.click(toggle);
    const endpoint = document.getElementById(
      'modelSpecs-list-0-preset-endpoint',
    ) as HTMLSelectElement;
    expect(endpoint.tagName).toBe('SELECT');
    expect(endpoint.value).toBe('openAI');
    const values = [...endpoint.querySelectorAll('option')].map((option) => option.value);
    expect(values).toEqual(
      expect.arrayContaining(['openAI', 'anthropic', 'agents', 'GPT', 'Claude']),
    );
    expect(values).not.toContain('custom');
    expect(
      (document.getElementById('modelSpecs-list-0-preset-model') as HTMLInputElement).value,
    ).toBe('gpt-4o');
  });

  it('moves the default to the spec it is set on (one default per list)', () => {
    expect(
      withDefault(SPECS, 1, 'default').map((spec) => (spec as t.ConfigRecord).default),
    ).toEqual([undefined, true]);
    const soft = withDefault(
      [{ name: 'a', softDefault: true, default: true }, { name: 'b' }],
      1,
      'soft',
    );
    expect(soft).toEqual([
      { name: 'a', default: true },
      { name: 'b', softDefault: true },
    ]);
    expect(withDefault(SPECS, 0, 'none')[0]).not.toHaveProperty('default');
    const explicit = [{ name: 'a', default: false }, { name: 'b' }];
    expect(withDefault(explicit, 1, 'default')[0]).toBe(explicit[0]);
  });

  it('maps "How users pick models" onto enforce and prioritize', () => {
    const { onChange } = renderSpecs({ list: SPECS, enforce: false, prioritize: true });
    expect(screen.getByLabelText('com_config_specs_mode_prioritize')).toBeChecked();
    fireEvent.click(screen.getByLabelText('com_config_specs_mode_enforce'));
    expect(onChange).toHaveBeenCalledWith('modelSpecs.enforce', true);
    expect(onChange).not.toHaveBeenCalledWith('modelSpecs.prioritize', expect.anything());
    fireEvent.click(screen.getByLabelText('com_config_specs_mode_endpoints'));
    expect(onChange).toHaveBeenCalledWith('modelSpecs.prioritize', false);
  });

  it('adds endpoints next to the specs only from the configured ones (no blank or typed names)', () => {
    const { onChange } = renderSpecs({ list: SPECS, addedEndpoints: ['openAI', 'Gone'] });
    const picker = document.getElementById('modelSpecs-addedEndpoints-add') as HTMLSelectElement;
    const options = [...picker.querySelectorAll('option')].map((option) => option.value);
    expect(options).not.toContain('');
    expect(options).not.toContain('openAI');
    expect(options).toContain('agents');
    expect(screen.getByText('com_config_specs_not_configured {"name":"Gone"}')).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'agents' } });
    expect(onChange).toHaveBeenCalledWith('modelSpecs.addedEndpoints', [
      'openAI',
      'Gone',
      'agents',
    ]);
    fireEvent.click(
      screen.getByRole('button', { name: /com_config_specs_chip_remove \{"name":"Gone"\}/ }),
    );
    expect(onChange).toHaveBeenCalledWith('modelSpecs.addedEndpoints', ['openAI']);
  });

  it('flags spec problems on the row and at the field', () => {
    renderSpecs({
      list: [...SPECS, { name: 'gpt', label: 'Copy', preset: { endpoint: 'Nope', model: 'm' } }],
    });
    const card = document.querySelectorAll<HTMLElement>('[data-entry-card]')[2];
    expect(within(card).getByText('com_config_specs_badge_errors {"count":1}')).toBeInTheDocument();
    fireEvent.click(within(card).getAllByRole('button', { expanded: false })[0]);
    expect(
      within(card).getByText(/com_config_issue_spec_duplicate_name/, {
        selector: '[role="alert"]',
      }),
    ).toBeInTheDocument();
    expect(within(card).getByText(/com_config_issue_spec_unknown_endpoint/)).toBeInTheDocument();
  });

  it('keeps a new spec\'s required fields under "Set values only"', () => {
    renderSpecs({ list: [...SPECS, {}] }, { showConfiguredOnly: true });
    const card = document.querySelectorAll<HTMLElement>('[data-entry-card]')[2];
    fireEvent.click(within(card).getAllByRole('button', { expanded: false })[0]);
    for (const id of ['label', 'name', 'preset-endpoint', 'preset-model']) {
      expect(document.getElementById(`modelSpecs-list-2-${id}`)).toBeInTheDocument();
    }
    expect(document.getElementById('modelSpecs-list-2-description')).toBeNull();
    const saved = document.querySelectorAll<HTMLElement>('[data-entry-card]')[0];
    fireEvent.click(within(saved).getAllByRole('button', { expanded: false })[0]);
    expect(document.getElementById('modelSpecs-list-0-preset-model')).toBeInTheDocument();
    expect(document.getElementById('modelSpecs-list-0-description')).toBeNull();
  });

  it('shows the inherited list read-only in a profile until it is customized', () => {
    const base = baseConfigFixture({ dbOverrides: { modelSpecs: { list: SPECS } } });
    const data = valuesDataFixture(scopeLayersFixture(undefined, base));
    renderSpecs({ list: SPECS }, { data });
    expect(screen.queryByRole('button', { name: 'com_config_specs_add' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /com_config_ctl_entry_move/ })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /com_config_specs_customize/ }));
    expect(screen.getByRole('button', { name: 'com_config_specs_add' })).toHaveFocus();
    expect(screen.getByText(/com_config_specs_customizing/)).toBeInTheDocument();
  });

  it('says an inherited endpoint list cannot be emptied in a profile (D3)', () => {
    const base = baseConfigFixture({ dbOverrides: { modelSpecs: { addedEndpoints: ['openAI'] } } });
    const data = valuesDataFixture(scopeLayersFixture(undefined, base));
    const { onChange } = renderSpecs({ list: SPECS, addedEndpoints: ['openAI'] }, { data });
    fireEvent.click(screen.getByRole('button', { name: /com_config_specs_chip_remove/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('com_config_ctl_clear_unavailable')).toBeInTheDocument();
  });

  it('offers an Anthropic spec only Anthropic parameters', () => {
    renderSpecs({ list: SPECS });
    const card = document.querySelectorAll<HTMLElement>('[data-entry-card]')[1];
    fireEvent.click(within(card).getAllByRole('button', { expanded: false })[0]);
    fireEvent.click(within(card).getByRole('button', { name: /com_config_specs_group_params/ }));
    expect(document.getElementById('modelSpecs-list-1-preset-topK')).not.toBeNull();
    expect(document.getElementById('modelSpecs-list-1-preset-top_p')).toBeNull();
    expect(document.getElementById('modelSpecs-list-1-preset-frequency_penalty')).toBeNull();
  });
});

describe('spec helpers', () => {
  it('derives a unique name from a label', () => {
    expect(slugify('GPT 5 mini!', new Set())).toBe('gpt-5-mini');
    expect(slugify('GPT', new Set(['gpt', 'gpt-2']))).toBe('gpt-3');
    expect(slugify('  ', new Set())).toBe('spec');
  });

  it('says what users will see', () => {
    const localize: t.LocalizeFn = (key, params) => `${key}${params ? JSON.stringify(params) : ''}`;
    const items = [{ name: 'a' }, { name: 'b', showInMenu: false }];
    expect(
      previewText(localize, { items, mode: 'prioritize', menuOn: true, added: ['OpenAI'] }),
    ).toBe(
      'com_config_specs_preview_added{"specs":"com_config_specs_preview_specs{\\"count\\":1}","endpoints":"OpenAI"} com_config_specs_preview_hidden{"count":1}',
    );
    expect(previewText(localize, { items: [], mode: 'enforce', menuOn: true, added: [] })).toBe(
      'com_config_specs_preview_none',
    );
    expect(previewText(localize, { items, mode: 'enforce', menuOn: true, added: [] })).toMatch(
      /^com_config_specs_preview_enforce/,
    );
  });
});
