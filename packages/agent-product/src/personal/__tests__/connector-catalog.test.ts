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

  it('carries a client the owner registered, with its scopes and sign-in options, from the owner’s file', () => {
    const entry = catalogEntryOf(
      {
        ...OK,
        oauth: {
          clientId: 'my-client',
          scopes: ['notes.read', 'notes.write'],
          authorizationParams: { access_type: 'offline', prompt: 'consent' },
        },
      },
      'file',
    );
    expect(entry?.oauth).toEqual({
      clientId: 'my-client',
      scopes: ['notes.read', 'notes.write'],
      authorizationParams: { access_type: 'offline', prompt: 'consent' },
    });
  });

  it('never keeps a client secret, even when the file has one, and never takes a client from another source', () => {
    const withSecret = catalogEntryOf(
      { ...OK, oauth: { clientId: 'my-client', clientSecret: 'the-secret' } },
      'file',
    );
    expect(withSecret?.oauth).toEqual({ clientId: 'my-client' });
    expect(JSON.stringify(withSecret)).not.toContain('the-secret');
    const fromElsewhere = catalogEntryOf(
      { ...OK, oauth: { clientId: 'someone-elses' } },
      'registry',
    );
    expect(fromElsewhere).toBeDefined();
    expect(fromElsewhere).not.toHaveProperty('oauth');
  });

  it.each([
    ['sign-in settings that are not an object', { oauth: 'my-client' }],
    ['a client id with a space', { oauth: { clientId: 'two words' } }],
    ['scopes that are not a list of words', { oauth: { scopes: 'notes.read' } }],
    ['a scope that is not one word', { oauth: { scopes: ['read all'] } }],
    [
      'sign-in options that replace what the sign-in sets itself',
      { oauth: { authorizationParams: { Prompt: 'consent' } } },
    ],
    ['a sign-in option that is not a word', { oauth: { authorizationParams: { prompt: 7 } } }],
    [
      'a client for a service that takes a token',
      { auth: 'token', oauth: { clientId: 'my-client' } },
    ],
    [
      'a client for a service that needs no sign-in',
      { auth: 'none', oauth: { clientId: 'my-client' } },
    ],
  ])('is left out when the owner’s file gives %s', (_name, extra) => {
    expect(catalogEntryOf({ ...OK, ...extra }, 'file')).toBeUndefined();
  });

  it('clips long text to one plain line and drops control characters', () => {
    const entry = catalogEntryOf(
      { ...OK, title: `${'t'.repeat(200)}`, description: `a\u0000b‮${'d'.repeat(900)}` },
      'file',
    )!;
    expect(entry.title).toHaveLength(80);
    expect(entry.description!.length).toBeLessThanOrEqual(300);
    expect([...entry.description!].some((character) => character.charCodeAt(0) < 32)).toBe(false);
    // Direction overrides and zero-width marks are removed, not just spaced.
    expect(catalogEntryOf({ ...OK, title: 'Not\u202Eesab\u200Bd' }, 'file')!.title).toBe(
      'Notesabd',
    );
  });

  describe('joiners in a name', () => {
    const titleOf = (title: string) => catalogEntryOf({ ...OK, title }, 'file')?.title;

    it.each([
      ['Persian', 'می‌خواهم'],
      ['Devanagari', 'क्‍ष'],
      ['an emoji sequence', '\u{1F468}‍\u{1F469}‍\u{1F467} Family notes'],
      ['an emoji with a presentation selector', '❤️‍\u{1F525} Heat'],
    ])('keeps a joiner between word or emoji characters in %s', (_name, title) => {
      expect(titleOf(title)).toBe(title);
    });

    it.each([
      ['at the start', '‍Notes', 'Notes'],
      ['at the end', 'Notes‌', 'Notes'],
      ['beside a space', 'My ‍notes', 'My notes'],
      ['beside a space on the other side', 'My‌ notes', 'My notes'],
      ['doubled', 'No‍‍tes', 'Notes'],
      ['beside a control character', 'My\u0000‍notes', 'My notes'],
      ['beside punctuation', 'My-‍notes', 'My-notes'],
    ])('drops a joiner %s', (_where, title, expected) => {
      expect(titleOf(title)).toBe(expected);
    });

    describe('at the clipped end', () => {
      const entryOf = (text: string) =>
        catalogEntryOf({ ...OK, title: text, description: text }, 'file')!;
      const limits = [
        ['title', 80, (text: string) => entryOf(text).title],
        ['description', 300, (text: string) => entryOf(text).description!],
      ] as const;

      it.each(limits)('leaves no joiner last when it sat at the %s limit', (_name, limit, read) => {
        const clipped = read('x'.repeat(limit - 1) + '‍' + 'y');
        expect(clipped).toBe('x'.repeat(limit - 1));
        const sequence = read('a'.repeat(limit - 2) + '\u{1F468}‍\u{1F469}');
        expect(sequence).toBe('a'.repeat(limit - 2) + '\u{1F468}');
      });

      it.each(limits)(
        'never cuts an emoji into a lone surrogate at the %s limit',
        (_name, limit, read) => {
          const clipped = read('x'.repeat(limit - 1) + '\u{1F600}');
          expect(clipped).toBe('x'.repeat(limit - 1) + '\u{1F600}');
          expect(clipped.isWellFormed()).toBe(true);
          expect(read('x'.repeat(limit) + '\u{1F600}')).toBe('x'.repeat(limit));
        },
      );
    });

    it.each([
      ['direction overrides', 'Not‮esab⁦d⁩؜‎‏', 'Notesabd'],
      ['zero-width spaces', 'No​tes', 'Notes'],
      ['a word joiner', 'No⁠tes', 'Notes'],
      ['the byte order mark', '﻿Notes', 'Notes'],
      ['a soft hyphen', 'No­tes', 'Notes'],
      ['tag characters', 'No\u{E0041}tes', 'Notes'],
    ])('still removes %s', (_name, title, expected) => {
      expect(titleOf(title)).toBe(expected);
    });
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

  it('offers the first remote that can be signed in to, even when an earlier one cannot', () => {
    const entries = catalogEntriesFromRegistry({
      servers: [
        server(http('https://a.example.test/mcp'), {
          remotes: [
            http('https://{tenant}.example.test/mcp'),
            http('https://two.example.test/mcp', [
              { name: 'X-A', isRequired: true, isSecret: true },
              { name: 'X-B', isRequired: true, isSecret: true },
            ]),
            { type: 'sse', url: 'https://sse.example.test/mcp' },
            http('https://usable.example.test/mcp'),
            http('https://later.example.test/mcp'),
          ],
        }),
      ],
    });
    expect(entries.map((entry) => entry.endpoint)).toEqual(['https://usable.example.test/mcp']);
  });

  it('never takes a client from a registry, whatever the page says', () => {
    const [entry] = catalogEntriesFromRegistry({
      servers: [
        server(
          { ...http('https://a.example.test/mcp'), oauth: { clientId: 'evil-remote' } },
          { oauth: { clientId: 'evil-server' } },
        ),
      ],
    });
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty('oauth');
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
