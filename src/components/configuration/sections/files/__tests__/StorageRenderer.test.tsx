import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderSections } from '@/test/sections';

const STORAGE = ['fileStrategy', 'fileStrategies', 'cloudfront'];

describe('StorageRenderer', () => {
  it('renders the three storage sections as one Storage card', () => {
    renderSections({ sections: STORAGE });
    expect(screen.getByRole('heading', { level: 2, name: /Storage/ })).toHaveTextContent(
      /0 of 6 set/,
    );
    expect(screen.getByRole('heading', { level: 2, name: /Storage/ })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getByLabelText('Storage backend')).toHaveDisplayValue(
      'Default (Local filesystem)',
    );
    expect(screen.getByText(/No setup needed/)).toBeInTheDocument();
    expect(screen.getByText(/CloudFront isn't in use/)).toBeInTheDocument();
  });

  it('confirms a backend change with what it needs before staging it', () => {
    const onChange = vi.fn();
    renderSections({ sections: STORAGE, onChange });
    fireEvent.change(screen.getByLabelText('Storage backend'), { target: { value: 's3' } });
    const dialog = screen.getByRole('dialog', { name: 'Switch file storage to Amazon S3?' });
    expect(within(dialog).getByText('AWS_BUCKET_NAME')).toBeInTheDocument();
    expect(within(dialog).getByText(/stay in Local filesystem/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Storage backend')).toHaveDisplayValue(
      'Default (Local filesystem)',
    );

    fireEvent.change(screen.getByLabelText('Storage backend'), { target: { value: 's3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Amazon S3' }));
    expect(onChange).toHaveBeenCalledWith('fileStrategy', 's3');
    expect(screen.getByLabelText('Storage backend')).toHaveDisplayValue('Amazon S3');
  });

  it('names what each file type inherits, as getFileStrategy resolves it', () => {
    renderSections({
      sections: STORAGE,
      yaml: { fileStrategy: 's3', fileStrategies: { image: 'firebase' } },
    });
    expect(screen.getByLabelText('Profile pictures')).toHaveDisplayValue('Inherit (Amazon S3)');
    expect(screen.getByLabelText('Images')).toHaveDisplayValue('librechat.yaml (Firebase Storage)');
    expect(screen.getByLabelText('Skill files')).toHaveDisplayValue(
      'By file type (images: Firebase Storage, documents: Amazon S3)',
    );
  });

  it('warns when the per-type default takes precedence over the backend', () => {
    renderSections({ sections: STORAGE, yaml: { fileStrategies: { default: 'azure_blob' } } });
    expect(screen.getByText(/takes precedence over this setting/)).toBeInTheDocument();
  });

  it('says when CloudFront is selected but librechat.yaml never set it up', () => {
    renderSections({ sections: STORAGE, yaml: { fileStrategies: { image: 'cloudfront' } } });
    expect(screen.getByRole('alert')).toHaveTextContent(/uploads to it fail/);
    expect(screen.getByRole('heading', { level: 2, name: /Storage/ })).toHaveTextContent(
      /of 16 set/,
    );
  });

  it('only offers CloudFront once librechat.yaml set it up', () => {
    const { unmount } = renderSections({ sections: STORAGE });
    const option = within(screen.getByLabelText('Storage backend')).getByRole('option', {
      name: /^Amazon CloudFront \(S3\): set up in librechat.yaml first$/,
    });
    expect(option).toBeDisabled();
    unmount();

    renderSections({
      sections: STORAGE,
      yaml: { fileStrategy: 'cloudfront', cloudfront: { domain: 'https://cdn.example.com' } },
    });
    expect(
      within(screen.getByLabelText('Storage backend')).getByRole('option', {
        name: 'Amazon CloudFront (S3)',
      }),
    ).not.toBeDisabled();
    expect(screen.getByText(/Values saved in the admin panel are never applied/)).toBeVisible();
  });
});
