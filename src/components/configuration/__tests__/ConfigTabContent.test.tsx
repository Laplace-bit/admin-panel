import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type * as t from '@/types';
import { ConfigTabContent } from '../ConfigTabContent';
import '@/locales/i18n';

/** One section the tab could show; the filter or "Set values only" hides it. */
const SECTIONS: t.ConfigSectionConfig[] = [
  {
    id: 'interface',
    titleKey: 'com_config_section_interface',
    fields: [
      {
        key: 'customWelcome',
        path: 'interface.customWelcome',
        type: 'string',
        isOptional: true,
        depth: 1,
      },
    ],
  },
];

describe('ConfigTabContent empty states', () => {
  it('announces that the filter matches no setting on the tab as a status message', () => {
    render(
      <ConfigTabContent
        sections={SECTIONS}
        configValues={{}}
        editedValues={{}}
        onFieldChange={vi.fn()}
        visibleSectionIds={new Set()}
        filterText="zzzzxx"
        onClearFilter={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No settings on this tab match “zzzzxx”');
    expect(screen.getByRole('button', { name: 'Clear filter' })).toBeVisible();
  });

  it('announces that "Set values only" leaves nothing on the tab as a status message', () => {
    render(
      <ConfigTabContent
        sections={SECTIONS}
        configValues={{}}
        editedValues={{}}
        onFieldChange={vi.fn()}
        showConfiguredOnly
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Nothing is set on this tab');
  });
});
