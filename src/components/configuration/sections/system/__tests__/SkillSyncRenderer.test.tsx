import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderSections } from '@/test/sections';

describe('SkillSyncRenderer', () => {
  it('shows sources as owner/repo cards with their branch and folders', () => {
    renderSections({
      sections: ['skillSync'],
      yaml: {
        skillSync: {
          github: {
            enabled: true,
            sources: [{ id: 'team', owner: 'acme', repo: 'skills', ref: 'v2', paths: ['a', 'b'] }],
          },
        },
      },
    });
    expect(screen.getByText('acme/skills')).toBeInTheDocument();
    expect(screen.getByText('v2 · 2 folders')).toBeInTheDocument();
  });

  it('adds a source from the group header', () => {
    const onChange = vi.fn();
    renderSections({ sections: ['skillSync'], onChange });
    expect(screen.getByText(/No sources yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    expect(onChange).toHaveBeenCalledWith('skillSync.github.sources', [{}]);
  });
});
