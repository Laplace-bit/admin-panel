import { describe, it, expect } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { otherServices, selectedServices, webSearchTocItems } from '../services';
import { WebSearchRenderer } from '../WebSearch';
import { renderSection } from './harness';
import '@/locales/i18n';

const YAML = {
  webSearch: {
    searchProvider: 'tavily',
    scraperProvider: 'tavily',
    tavilyApiKey: '${TAVILY_API_KEY}',
    rerankerType: 'cohere',
  },
};

const heading = (name: RegExp) => screen.getByRole('heading', { name });

describe('selectedServices', () => {
  it('shows a service selected for two roles once, with both roles and every setting it reads', () => {
    const views = selectedServices({
      providers: 'tavily',
      scrapers: 'tavily',
      rerankers: 'none',
    });
    expect(views).toHaveLength(1);
    expect(views[0].roles).toEqual(['providers', 'scrapers']);
    expect(views[0].credentials.map((credential) => credential.key)).toEqual([
      'tavilyApiKey',
      'tavilySearchUrl',
      'tavilyExtractUrl',
    ]);
    expect(views[0].optionKeys).toEqual(['tavilySearchOptions', 'tavilyScraperOptions']);
  });

  it("adds the settings of a used service's other roles to its view, without the role", () => {
    const [tavily] = selectedServices({ providers: 'tavily' });
    expect(tavily.roles).toEqual(['providers']);
    expect(tavily.credentials.map((credential) => credential.key)).toEqual([
      'tavilyApiKey',
      'tavilySearchUrl',
      'tavilyExtractUrl',
    ]);
    expect(tavily.optionKeys).toEqual(['tavilySearchOptions', 'tavilyScraperOptions']);
    expect(otherServices([tavily]).map((view) => view.value)).not.toContain('tavily');
  });

  it('lists every other service once for "Show other services"', () => {
    const others = otherServices(selectedServices({ providers: 'serper' }));
    expect(others.map((view) => view.value)).toEqual([
      'searxng',
      'tavily',
      'keenable',
      'firecrawl',
      'jina',
      'cohere',
    ]);
  });
});

describe('WebSearchRenderer', () => {
  it('shows only the selected services, credentials first, with where each comes from', () => {
    renderSection(WebSearchRenderer, { section: 'webSearch', yaml: YAML });
    expect(heading(/^Tavily · search, page scraping/)).toBeInTheDocument();
    expect(heading(/^Cohere · reranking/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Serper/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Firecrawl API key')).not.toBeInTheDocument();
    expect(
      screen.getByText('Read from the TAVILY_API_KEY environment variable on the server.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Not set here: LibreChat reads the COHERE_API_KEY environment variable on the server.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps the other services behind "Show other services"', () => {
    renderSection(WebSearchRenderer, { section: 'webSearch', yaml: YAML });
    fireEvent.click(screen.getByRole('button', { name: 'Show other services (5)' }));
    expect(heading(/^Serper/)).toBeInTheDocument();
    expect(heading(/^Firecrawl/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide other services' }));
    expect(screen.queryByRole('heading', { name: /^Firecrawl/ })).not.toBeInTheDocument();
  });

  it('keeps a service with only a pending setting under "Set values only"', () => {
    renderSection(WebSearchRenderer, {
      section: 'webSearch',
      yaml: { webSearch: { searchProvider: 'serper' } },
      edited: { 'webSearch.serperApiKey': 'sk-typed' },
      props: { showConfiguredOnly: true },
    });
    expect(heading(/^Serper/)).toBeInTheDocument();
  });

  it('masks a typed key and says it will be stored encrypted', () => {
    renderSection(WebSearchRenderer, { section: 'webSearch', yaml: YAML });
    const key = screen.getByLabelText('Cohere API key');
    fireEvent.change(key, { target: { value: 'co-secret-1234567890' } });
    expect(key).toHaveAttribute('type', 'password');
    fireEvent.blur(key);
    expect(screen.getByText('Will be stored encrypted when you save.')).toBeInTheDocument();
  });

  it('shows a stored key only as its masked preview, with Replace', () => {
    renderSection(WebSearchRenderer, {
      section: 'webSearch',
      yaml: YAML,
      overrides: { webSearch: { cohereApiKeyPreview: '...7890' } },
    });
    expect(screen.getByDisplayValue('...7890')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Replace/ })).toBeInTheDocument();
    expect(
      screen.getByText('Stored encrypted. Only the last characters are shown.'),
    ).toBeInTheDocument();
  });

  it('flags a required credential a selected service is missing', () => {
    renderSection(WebSearchRenderer, {
      section: 'webSearch',
      yaml: { webSearch: { searchProvider: 'serper', serperApiKey: '' } },
    });
    expect(screen.getByText(/Serper needs this\./)).toHaveTextContent('${SERPER_API_KEY}');
  });

  it('explains Automatic when a service is not chosen', () => {
    renderSection(WebSearchRenderer, { section: 'webSearch' });
    expect(screen.getByText(/^Automatic \(search, page scraping, reranking\)/)).toBeInTheDocument();
  });

  it('while the tab filter matches a service that is not selected, shows it', () => {
    renderSection(WebSearchRenderer, {
      section: 'webSearch',
      yaml: YAML,
      filter: ['webSearch.firecrawlApiKey'],
    });
    expect(screen.getByLabelText('Firecrawl API key')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Cohere/ })).not.toBeInTheDocument();
  });
});

describe('webSearchTocItems', () => {
  it('lists the services the section shows, not the ones behind "Show all services"', () => {
    const items = webSearchTocItems(
      {
        webSearch: { searchProvider: 'tavily', scraperProvider: 'tavily', rerankerType: 'cohere' },
      },
      'webSearch',
      (key) => key,
    );
    expect(items.map((item) => item.id)).toEqual([
      'section-webSearch-service-tavily',
      'section-webSearch-service-cohere',
    ]);
  });
});
