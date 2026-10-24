import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';

const apiFetchMock = vi.fn();

vi.mock('../utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({ handler: (fn: (...args: never[]) => unknown) => fn }),
    handler: (fn: (...args: never[]) => unknown) => fn,
  }),
}));

vi.mock('@tanstack/react-query', () => ({ queryOptions: (opts: unknown) => opts }));

import { getResolvedConfigFn } from '../scopes/resolved';
import { getBaseConfigFn } from './base';

function reply(status: number, body?: object): Response {
  return new Response(body ? JSON.stringify(body) : null, { status });
}

const yaml = { balance: { startBalance: 1000 } };

/** Answers the base reads: the merged base, librechat.yaml alone, and the base document. */
function serveBase(doc: Response) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path.startsWith('/api/admin/config/base')) return reply(200, { config: yaml });
    return doc;
  });
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('the revision of the stored document (expectedRevision)', () => {
  it('reads the base document revision', async () => {
    serveBase(reply(200, { config: { overrides: {}, tombstones: [], revision: '6adb:7' } }));
    const data = await getBaseConfigFn();
    expect(data.dbRevision).toBe('6adb:7');
  });

  it('reads no base document as a null revision', async () => {
    serveBase(reply(404, { error: 'Config not found' }));
    const data = await getBaseConfigFn();
    expect(data).toMatchObject({ dbOverrides: undefined, dbRevision: null });
  });

  it('leaves the revision out where the server reports none', async () => {
    serveBase(reply(200, { config: { overrides: {}, tombstones: [] } }));
    const data = await getBaseConfigFn();
    expect(data).not.toHaveProperty('dbRevision');
  });

  it("reads a profile document's revision", async () => {
    apiFetchMock.mockResolvedValue(
      reply(200, { config: { overrides: { balance: { startBalance: 5 } }, revision: 'eng:3' } }),
    );
    const data = await getResolvedConfigFn({
      data: { principalType: PrincipalType.GROUP, principalId: 'eng' },
    });
    expect(data).toMatchObject({ revision: 'eng:3', changedPaths: ['balance.startBalance'] });
  });
});
