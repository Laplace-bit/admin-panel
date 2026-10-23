import { useState } from 'react';
import { configSchema } from 'librechat-data-provider';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import type * as t from '@/types';
import {
  valuesDataFixture,
  baseConfigFixture,
  baseLayersFixture,
  scopeLayersFixture,
} from '@/test/layers';
import { CollectionEditsContext } from '@/contexts/CollectionEditsContext';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { CustomEndpointsRenderer } from '../CustomEndpointsRenderer';
import { extractSchemaTree } from '@/server/config';
import { isConfigRecord } from '@/utils';

vi.mock('@/hooks/useLocalize', () => {
  const localize = (key: string, params?: Record<string, string | number>) =>
    params?.name ? `${key}:${params.name}` : key;
  return { default: () => localize, useLocalize: () => localize };
});

/** jsdom has no ResizeObserver; Radix checkboxes inside a form measure themselves with one. */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
});

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const fields = tree.find((field) => field.key === 'endpoints')?.children ?? [];

const ADMIN_ENTRY: t.ConfigRecord = {
  name: 'Mine',
  apiKey: 'user_provided',
  baseURL: 'https://mine.example.com/v1',
  models: { default: ['m-1'] },
};

/** Base: librechat.yaml's GPT and Claude, GPT's base URL overridden, and `Mine` added in the panel. */
function baseLayers(): t.ValueLayers {
  return baseLayersFixture(
    baseConfigFixture({
      dbOverrides: {
        endpoints: {
          custom: [{ name: 'GPT', baseURL: 'https://override.example.com' }, ADMIN_ENTRY],
        },
      },
    }),
  );
}

function savedList(layers: t.ValueLayers): t.ConfigValue[] {
  const endpoints = layers.effective?.endpoints;
  const list =
    endpoints && typeof endpoints === 'object' && !Array.isArray(endpoints)
      ? endpoints.custom
      : undefined;
  return Array.isArray(list) ? list : [];
}

function Harness({
  layers,
  initial,
  onChange,
  collectionEdits = {},
  showConfiguredOnly,
}: {
  layers: t.ValueLayers;
  initial?: t.ConfigValue[];
  onChange?: (path: string, value: t.ConfigValue) => void;
  collectionEdits?: t.CollectionEdits;
  showConfiguredOnly?: boolean;
}) {
  const [items, setItems] = useState<t.ConfigValue[]>(initial ?? savedList(layers));
  const handleChange = (path: string, value: t.ConfigValue) => {
    onChange?.(path, value);
    if (path === 'endpoints.custom' && Array.isArray(value)) setItems(value);
    const match = /^endpoints\.custom\.(\d+)$/.exec(path);
    if (match) setItems((prev) => prev.map((item, i) => (i === Number(match[1]) ? value : item)));
  };
  return (
    <ConfigValuesProvider value={valuesDataFixture(layers)}>
      <CollectionEditsContext.Provider value={collectionEdits}>
        <CustomEndpointsRenderer
          fields={fields}
          parentPath="endpoints"
          parentValue={{ custom: items }}
          getValue={(path, fallback) => (path === 'endpoints.custom' ? items : fallback)}
          onChange={handleChange}
          showConfiguredOnly={showConfiguredOnly}
        />
      </CollectionEditsContext.Provider>
    </ConfigValuesProvider>
  );
}

function row(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`li[data-endpoint-row="${name}"]`);
  if (!element) throw new Error(`no row for ${name}`);
  return element;
}

function openRow(name: string): HTMLElement {
  fireEvent.click(within(row(name)).getByRole('button', { name }));
  return screen.getByRole('dialog');
}

async function typeInto(selector: string, text: string) {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`no ${selector}`);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
  await act(async () => {
    vi.runOnlyPendingTimers();
  });
}

describe('CustomEndpointsRenderer', () => {
  it('lists each endpoint with where it comes from and its host', () => {
    render(<Harness layers={baseLayers()} />);
    expect(within(row('GPT')).getByText('com_config_ce_source_yaml_overrides')).toBeInTheDocument();
    expect(within(row('Claude')).getByText('com_config_ce_source_yaml')).toBeInTheDocument();
    expect(within(row('Mine')).getByText('com_config_ce_source_admin')).toBeInTheDocument();
    expect(within(row('GPT')).getByText(/override\.example\.com/)).toBeInTheDocument();
    expect(within(row('Mine')).queryByText('com_config_ce_status_unserved')).toBeNull();
  });

  it('marks an endpoint LibreChat would not serve (CE-3)', () => {
    render(<Harness layers={baseLayers()} initial={[{ name: 'OnlyName' }]} />);
    expect(within(row('OnlyName')).getByText('com_config_ce_status_unserved')).toBeInTheDocument();
  });

  it('keeps the name of a librechat.yaml endpoint read-only and offers no delete (D1)', () => {
    render(<Harness layers={baseLayers()} />);
    const drawer = openRow('Claude');
    const name = drawer.querySelector('#endpoints-custom-1-name');
    expect(name?.tagName).not.toBe('INPUT');
    expect(name).toHaveTextContent('Claude');
    expect(
      within(drawer).queryByRole('button', { name: 'com_config_ce_action_delete' }),
    ).toBeNull();
  });

  it('lets an endpoint added in the panel be renamed and deleted', () => {
    const onChange = vi.fn();
    render(<Harness layers={baseLayers()} onChange={onChange} />);
    const drawer = openRow('Mine');
    expect(drawer.querySelector('input#endpoints-custom-2-name')).not.toBeDisabled();
    fireEvent.click(within(drawer).getByRole('button', { name: 'com_config_ce_action_delete' }));
    expect(onChange).toHaveBeenLastCalledWith('endpoints.custom', [
      expect.objectContaining({ name: 'GPT' }),
      expect.objectContaining({ name: 'Claude' }),
    ]);
  });

  it('leaves a cleared name editable when the layer beneath defines no endpoints', () => {
    const layers = baseLayersFixture(
      baseConfigFixture({ yamlConfig: {}, config: {}, yamlPaths: [], dbOverrides: {} }),
    );
    render(
      <Harness layers={layers} initial={[{ name: '', baseURL: 'https://x/v1', apiKey: 'k' }]} />,
    );
    fireEvent.click(document.querySelector('li[data-endpoint-row] button') as HTMLElement);
    expect(document.querySelector('input#endpoints-custom-0-name')).not.toBeDisabled();
  });

  it('lists a pending deletion from the edit state, with Undo (D9)', () => {
    const onChange = vi.fn();
    const layers = baseLayers();
    const saved = savedList(layers);
    const remaining = saved.slice(0, 2);
    const edits: t.CollectionEdits = {
      'endpoints.custom': {
        baseline: saved,
        origins: remaining.map((entry, i) => ({
          identity: ['GPT', 'Claude'][i],
          baseline: entry,
        })),
        detached: [{ value: saved[2], origin: { identity: 'Mine', baseline: saved[2] } }],
      },
    };
    render(
      <Harness layers={layers} initial={remaining} onChange={onChange} collectionEdits={edits} />,
    );
    expect(screen.getByText('com_config_ctl_entry_pending_delete')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_config_ctl_entry_undo_a11y:Mine' }));
    expect(onChange).toHaveBeenLastCalledWith('endpoints.custom', [...remaining, saved[2]]);
  });

  it('keeps a pending deletion the list filter matches listed, with Undo', () => {
    const layers = baseLayers();
    const saved = savedList(layers);
    const extra = ['E1', 'E2', 'E3', 'E4'].map((name) => ({ ...ADMIN_ENTRY, name }));
    const remaining = [...saved.slice(0, 2), ...extra];
    const edits: t.CollectionEdits = {
      'endpoints.custom': {
        baseline: saved,
        origins: remaining.map((entry, i) =>
          i < 2 ? { identity: ['GPT', 'Claude'][i], baseline: entry } : null,
        ),
        detached: [{ value: saved[2], origin: { identity: 'Mine', baseline: saved[2] } }],
      },
    };
    render(<Harness layers={layers} initial={remaining} collectionEdits={edits} />);
    fireEvent.change(screen.getByLabelText('com_config_ce_filter_a11y'), {
      target: { value: 'mine' },
    });
    expect(
      screen.getByRole('button', { name: 'com_config_ctl_entry_undo_a11y:Mine' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('com_config_ce_filter_a11y'), {
      target: { value: 'E1' },
    });
    expect(
      screen.queryByRole('button', { name: 'com_config_ctl_entry_undo_a11y:Mine' }),
    ).not.toBeInTheDocument();
  });

  it('restores an undone deletion relative to the surviving endpoints', () => {
    const onChange = vi.fn();
    const entry = (name: string): t.ConfigRecord => ({ ...ADMIN_ENTRY, name });
    const saved = [entry('A'), entry('B'), entry('C')];
    const layers = baseLayersFixture(
      baseConfigFixture({
        yamlConfig: {},
        config: {},
        yamlPaths: [],
        dbOverrides: { endpoints: { custom: saved } },
      }),
    );
    const remaining = [saved[2]];
    const edits: t.CollectionEdits = {
      'endpoints.custom': {
        baseline: saved,
        origins: [{ identity: 'C', baseline: saved[2] }],
        detached: [
          { value: saved[0], origin: { identity: 'A', baseline: saved[0] } },
          { value: saved[1], origin: { identity: 'B', baseline: saved[1] } },
        ],
      },
    };
    render(
      <Harness layers={layers} initial={remaining} onChange={onChange} collectionEdits={edits} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_config_ctl_entry_undo_a11y:B' }));
    expect(onChange).toHaveBeenLastCalledWith('endpoints.custom', [saved[1], saved[2]]);
    fireEvent.click(screen.getByRole('button', { name: 'com_config_ctl_entry_undo_a11y:A' }));
    expect(onChange).toHaveBeenLastCalledWith('endpoints.custom', saved);
  });

  it('opens an inherited endpoint read-only until it is overridden for the profile (CE-8)', () => {
    render(<Harness layers={scopeLayersFixture()} />);
    const drawer = openRow('Claude');
    const baseURL = () => drawer.querySelector('#endpoints-custom-1-baseURL');
    expect(baseURL()?.tagName).not.toBe('INPUT');
    fireEvent.click(within(drawer).getByRole('button', { name: 'com_config_ce_override_for' }));
    expect(baseURL()?.tagName).toBe('INPUT');
  });

  it('keeps a pending override of an inherited endpoint listed under "set values only"', () => {
    const layers = scopeLayersFixture();
    const saved = savedList(layers);
    const { rerender } = render(<Harness layers={layers} showConfiguredOnly />);
    expect(document.querySelector('li[data-endpoint-row="Claude"]')).toBeNull();
    const edited = saved.map((entry) =>
      isConfigRecord(entry) && entry.name === 'Claude'
        ? { ...entry, baseURL: 'https://edited.example.com' }
        : entry,
    );
    rerender(<Harness layers={layers} initial={edited} showConfiguredOnly key="edited" />);
    expect(row('Claude')).toBeInTheDocument();
  });

  it('keeps Create disabled until the endpoint can be served, then adds it', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(<Harness layers={baseLayers()} onChange={onChange} />);
      fireEvent.click(screen.getByRole('button', { name: 'com_config_create_endpoint' }));
      fireEvent.click(screen.getByRole('button', { name: /com_config_ce_template_blank_name/ }));
      const create = screen.getByRole('button', { name: 'com_config_ce_create' });
      expect(create).toBeDisabled();

      await typeInto('#endpoints-custom-9999-name', 'openAI');
      expect(screen.getByText('com_config_ce_issue_name_reserved')).toBeInTheDocument();
      await typeInto('#endpoints-custom-9999-name', 'New One');
      await typeInto('#endpoints-custom-9999-baseURL', 'https://new.example.com/v1');
      await typeInto('#endpoints-custom-9999-apiKey', '${NEW_KEY}');
      const models = document.querySelector<HTMLInputElement>(
        '#endpoints-custom-9999-models-default input:not([type="hidden"])',
      );
      if (!models) throw new Error('no model input');
      fireEvent.change(models, { target: { value: 'new-model' } });
      fireEvent.keyDown(models, { key: 'Enter' });
      await act(async () => {
        vi.runOnlyPendingTimers();
      });
      expect(create).not.toBeDisabled();
      fireEvent.click(create);
      expect(onChange).toHaveBeenLastCalledWith(
        'endpoints.custom',
        expect.arrayContaining([
          {
            name: 'New One',
            baseURL: 'https://new.example.com/v1',
            apiKey: '${NEW_KEY}',
            models: { default: ['new-model'] },
          },
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
