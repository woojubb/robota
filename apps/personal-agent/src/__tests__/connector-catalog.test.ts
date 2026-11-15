import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  REGISTRY_URL_VARIABLE,
  createConnectorCatalog,
  registryUrlFrom,
} from '../connectors/catalog.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function stateDir(entries?: unknown, raw?: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'agent-test-catalog-'));
  directories.push(directory);
  if (raw !== undefined) writeFileSync(join(directory, 'connector-catalog.json'), raw);
  else if (entries !== undefined) {
    writeFileSync(join(directory, 'connector-catalog.json'), JSON.stringify(entries));
  }
  return directory;
}

const remote = (name: string, url: string, description = '') => ({
  server: { name, description, remotes: [{ type: 'streamable-http', url }] },
  _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } },
});

/** A fetch standing in for the registry; every request it receives is kept. */
function registry(answer: () => Response | Promise<Response>) {
  const requests: { url: URL; init: RequestInit | undefined }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: new URL(String(input)), init });
    return answer();
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const page = (...servers: unknown[]) =>
  new Response(JSON.stringify({ servers }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('the services the add form can suggest', () => {
  it('asks the registry for the latest versions that match, without following a redirect', async () => {
    const stand = registry(() =>
      page(remote('example.test/notes', 'https://notes.example.test/mcp')),
    );
    const catalog = createConnectorCatalog({
      stateDir: stateDir(),
      registryUrl: 'https://registry.example.test',
      fetch: stand.fetch,
    });
    const answer = await catalog.search('  Notes ');
    expect(answer.registry).toBe('ok');
    expect(answer.entries.map((entry) => [entry.endpoint, entry.source])).toEqual([
      ['https://notes.example.test/mcp', 'registry'],
    ]);
    const [request] = stand.requests;
    expect(request!.url.origin + request!.url.pathname).toBe(
      'https://registry.example.test/v0.1/servers',
    );
    expect(Object.fromEntries(request!.url.searchParams)).toEqual({
      limit: '30',
      version: 'latest',
      search: 'notes',
    });
    expect(request!.init?.redirect).toBe('error');
  });

  it('puts the owner’s file first, filters it by what was typed, and lists an address once', async () => {
    const stand = registry(() =>
      page(
        remote('example.test/notes', 'https://notes.example.test/mcp'),
        remote('example.test/other', 'https://other.example.test/mcp'),
      ),
    );
    const catalog = createConnectorCatalog({
      stateDir: stateDir({
        entries: [
          { title: 'Team notes', endpoint: 'https://notes.example.test/mcp', kind: 'notes' },
          { title: 'Calendar', endpoint: 'https://calendar.example.test/mcp', kind: 'calendar' },
        ],
      }),
      registryUrl: 'https://registry.example.test',
      fetch: stand.fetch,
    });
    const answer = await catalog.search('notes');
    expect(answer.entries.map((entry) => [entry.title, entry.source])).toEqual([
      ['Team notes', 'file'],
      ['example.test/other', 'registry'],
    ]);
    // With nothing typed, everything the file holds is offered.
    expect(
      (await catalog.search('')).entries.filter((entry) => entry.source === 'file'),
    ).toHaveLength(2);
  });

  it.each([
    ['a refusal', () => new Response('no', { status: 503 })],
    ['a body that is not JSON', () => new Response('not json', { status: 200 })],
    [
      'a declared size that is too large',
      () =>
        new Response('{}', { status: 200, headers: { 'content-length': String(2 * 1024 * 1024) } }),
    ],
    [
      'a body that is too large',
      () => new Response(`{"servers":[],"x":"${'x'.repeat(1024 * 1024)}"}`),
    ],
  ])(
    'says the registry is unreachable on %s, and still offers the owner’s file',
    async (_name, answer) => {
      const catalog = createConnectorCatalog({
        stateDir: stateDir([{ title: 'Calendar', endpoint: 'https://calendar.example.test/mcp' }]),
        registryUrl: 'https://registry.example.test',
        fetch: registry(answer).fetch,
      });
      const found = await catalog.search('');
      expect(found.registry).toBe('unreachable');
      expect(found.entries.map((entry) => entry.title)).toEqual(['Calendar']);
    },
  );

  it('says the registry is unreachable when the request itself fails', async () => {
    const catalog = createConnectorCatalog({
      stateDir: stateDir(),
      registryUrl: 'https://registry.example.test',
      fetch: (async () => {
        throw new Error('connection refused');
      }) as typeof globalThis.fetch,
    });
    expect((await catalog.search('x')).registry).toBe('unreachable');
  });

  it('asks nothing of the network when the owner turned the registry off', async () => {
    const stand = registry(() => page());
    const catalog = createConnectorCatalog({
      stateDir: stateDir([{ title: 'Calendar', endpoint: 'https://calendar.example.test/mcp' }]),
      registryUrl: null,
      fetch: stand.fetch,
    });
    const answer = await catalog.search('');
    expect(answer.registry).toBe('off');
    expect(answer.entries).toHaveLength(1);
    expect(stand.requests).toEqual([]);
  });

  it('asks once for a repeated search, and again after a while', async () => {
    let clock = 0;
    const stand = registry(() => page());
    const catalog = createConnectorCatalog({
      stateDir: stateDir(),
      registryUrl: 'https://registry.example.test',
      fetch: stand.fetch,
      now: () => clock,
    });
    await catalog.search('notes');
    await catalog.search('NOTES ');
    expect(stand.requests).toHaveLength(1);
    clock += 6 * 60_000;
    await catalog.search('notes');
    expect(stand.requests).toHaveLength(2);
  });

  it('takes the owner’s file as a list or as entries, leaves out what the book would refuse, and survives a file that does not parse', async () => {
    const good = { title: 'Calendar', endpoint: 'https://calendar.example.test/mcp' };
    const bad = [{ title: 'Plain http', endpoint: 'http://x.example.test/mcp' }, 3, null];
    const off = { stateDir: undefined as never, registryUrl: null } as const;
    const titles = async (directory: string) =>
      (await createConnectorCatalog({ ...off, stateDir: directory }).search('')).entries.map(
        (entry) => entry.title,
      );
    expect(await titles(stateDir([good, ...bad]))).toEqual(['Calendar']);
    expect(await titles(stateDir({ entries: [good, ...bad] }))).toEqual(['Calendar']);
    expect(await titles(stateDir(undefined, '{ not json'))).toEqual([]);
    expect(await titles(stateDir())).toEqual([]);
  });
});

describe('the registry setting', () => {
  it('is the public registry when blank, off when asked, and otherwise an https address', () => {
    expect(registryUrlFrom({})).toBeUndefined();
    expect(registryUrlFrom({ [REGISTRY_URL_VARIABLE]: '  ' })).toBeUndefined();
    expect(registryUrlFrom({ [REGISTRY_URL_VARIABLE]: 'OFF' })).toBeNull();
    expect(registryUrlFrom({ [REGISTRY_URL_VARIABLE]: ' https://registry.example.test ' })).toBe(
      'https://registry.example.test',
    );
  });

  it.each(['http://registry.example.test', 'registry', 'ftp://registry.example.test'])(
    'refuses %s, so the agent never starts with it',
    (value) => {
      expect(() => registryUrlFrom({ [REGISTRY_URL_VARIABLE]: value })).toThrow(
        /must be an https address, or off/u,
      );
    },
  );
});
