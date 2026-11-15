import { describe, expect, it } from 'vitest';

import { catalogEntriesFromRegistry, catalogEntryOf } from '../index.js';

const OK = { title: 'Notes', endpoint: 'https://notes.example.test/mcp' };

describe('a catalog entry', () => {
  it('is a suggestion with the defaults of the add form: other, OAuth, no header', () => {
    expect(catalogEntryOf(OK, 'file')).toEqual({
      title: 'Notes',
      endpoint: 'https://notes.example.test/mcp',
      kind: 'other',
      auth: 'oauth',
      source: 'file',
    });
  });

  it('keeps a kind, a description, a token and the header it goes in', () => {
    expect(
      catalogEntryOf(
        {
          ...OK,
          kind: 'notes',
          description: 'Find   and\nfile notes',
          auth: 'token',
          tokenHeader: 'X-Api-Key',
        },
        'file',
      ),
    ).toEqual({
      title: 'Notes',
      endpoint: 'https://notes.example.test/mcp',
      kind: 'notes',
      auth: 'token',
      tokenHeader: 'X-Api-Key',
      description: 'Find and file notes',
      source: 'file',
    });
  });

  it('clips long text to one plain line and drops control characters', () => {
    const entry = catalogEntryOf(
      { ...OK, title: `${'t'.repeat(200)}`, description: `a\u0000b‮${'d'.repeat(900)}` },
      'file',
    )!;
    expect(entry.title).toHaveLength(80);
    expect(entry.description!.length).toBeLessThanOrEqual(300);
    expect([...entry.description!].some((character) => character.charCodeAt(0) < 32)).toBe(false);
  });

  it.each([
    ['not an object', 'text'],
    ['without a name', { endpoint: OK.endpoint }],
    ['without an address', { title: 'Notes' }],
    ['an address that is not https', { ...OK, endpoint: 'http://notes.example.test/mcp' }],
    ['an address that carries a credential', { ...OK, endpoint: `${OK.endpoint}?key=abc` }],
    [
      'an address with a user and password',
      { ...OK, endpoint: 'https://u:p@notes.example.test/mcp' },
    ],
    ['a kind that is not one', { ...OK, kind: 'toaster' }],
    ['a sign-in way that is not one', { ...OK, auth: 'password' }],
    ['a header for a service that signs in with OAuth', { ...OK, tokenHeader: 'X-Api-Key' }],
    ['a header the connection uses itself', { ...OK, auth: 'token', tokenHeader: 'Content-Type' }],
    [
      'a name that looks like a secret',
      { ...OK, title: 'sk-proj-abcdefghijklmnopqrstuvwx1234567890' },
    ],
  ])('is left out when it has %s', (_name, raw) => {
    expect(catalogEntryOf(raw, 'file')).toBeUndefined();
  });
});

describe('the entries of a registry page', () => {
  const server = (remote: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    server: { name: 'example.test/notes', description: 'Notes', remotes: [remote], ...extra },
    _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } },
  });
  const http = (url: string, headers?: unknown[]) => ({
    type: 'streamable-http',
    url,
    ...(headers !== undefined && { headers }),
  });

  it('offers a remote with no required header as an OAuth service, named by its title or else its name', () => {
    const entries = catalogEntriesFromRegistry({
      servers: [
        server(http('https://a.example.test/mcp'), { title: 'Alpha' }),
        server(http('https://b.example.test/mcp')),
      ],
    });
    expect(entries.map((entry) => [entry.title, entry.endpoint, entry.auth, entry.source])).toEqual(
      [
        ['Alpha', 'https://a.example.test/mcp', 'oauth', 'registry'],
        ['example.test/notes', 'https://b.example.test/mcp', 'oauth', 'registry'],
      ],
    );
  });

  it('offers a required secret bearer header as a token, and another required secret header as a token in that header', () => {
    const entries = catalogEntriesFromRegistry({
      servers: [
        server(
          http('https://a.example.test/mcp', [
            { name: 'Authorization', value: 'Bearer {api_key}', isRequired: true, isSecret: true },
          ]),
        ),
        server(
          http('https://b.example.test/mcp', [
            { name: 'X-Api-Key', value: '{key}', isRequired: true, isSecret: true },
          ]),
        ),
        server(
          http('https://c.example.test/mcp', [
            { name: 'Authorization', isRequired: true, isSecret: true },
          ]),
        ),
      ],
    });
    expect(entries.map((entry) => [entry.endpoint, entry.auth, entry.tokenHeader])).toEqual([
      ['https://a.example.test/mcp', 'token', undefined],
      ['https://b.example.test/mcp', 'token', 'X-Api-Key'],
      ['https://c.example.test/mcp', 'token', undefined],
    ]);
  });

  it('does not offer what pasting one token cannot fill in', () => {
    const entries = catalogEntriesFromRegistry({
      servers: [
        // an address with a variable the person would have to fill in
        server(http('https://{tenant}.example.test/mcp')),
        // two required headers
        server(
          http('https://two.example.test/mcp', [
            { name: 'X-A', isRequired: true, isSecret: true },
            { name: 'X-B', isRequired: true, isSecret: true },
          ]),
        ),
        // another scheme than a bearer token
        server(
          http('https://scheme.example.test/mcp', [
            { name: 'Authorization', value: 'Basic {pair}', isRequired: true, isSecret: true },
          ]),
        ),
        // a fixed header that is not secret
        server(
          http('https://fixed.example.test/mcp', [
            { name: 'X-Version', value: '2', isRequired: true },
          ]),
        ),
        // not the standard streaming transport
        server({ type: 'sse', url: 'https://sse.example.test/mcp' }),
        // withdrawn
        {
          ...server(http('https://gone.example.test/mcp')),
          _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deleted' } },
        },
        // only a package to run, no remote
        { server: { name: 'example.test/local', packages: [{ registryType: 'npm' }] } },
      ],
    });
    expect(entries).toEqual([]);
  });

  it('keeps one entry per address, and ignores a page that is not one', () => {
    const entries = catalogEntriesFromRegistry({
      servers: [
        server(http('https://a.example.test/mcp')),
        server(http('https://a.example.test/mcp')),
      ],
    });
    expect(entries).toHaveLength(1);
    for (const page of [undefined, null, 'x', {}, { servers: 'x' }, { servers: [null, 3, {}] }]) {
      expect(catalogEntriesFromRegistry(page)).toEqual([]);
    }
  });
});
