/**
 * TC-03a — strict decoding.
 *
 * Every refusal names the entry it refused. A decoder that returns a partial definition produces a
 * server that fails at connection time, by which point the operator can no longer see which file
 * it came from.
 */

import { describe, expect, it } from 'vitest';

import { decodeEntry, decodeSource, readRawEntries } from '../definition/decode.js';

import type { IMCPServerDefinitionRaw } from '../definition/types.js';

const raw = (entry: Record<string, unknown>, name = 'alpha'): IMCPServerDefinitionRaw => ({
  name,
  source: 'project',
  origin: '.mcp.json',
  entry,
});

describe('decodeEntry', () => {
  it('decodes a stdio definition', () => {
    const decoded = decodeEntry(raw({ type: 'stdio', command: 'server', args: ['--port', '1'] }));
    expect(decoded).toMatchObject({
      name: 'alpha',
      transport: 'stdio',
      command: 'server',
      args: ['--port', '1'],
    });
  });

  it('decodes an http definition and accepts streamable-http as the same transport', () => {
    expect(decodeEntry(raw({ type: 'http', url: 'https://a.example' }))).toMatchObject({
      transport: 'http',
      url: 'https://a.example',
    });
    expect(decodeEntry(raw({ type: 'streamable-http', url: 'https://a.example' }))).toMatchObject({
      transport: 'http',
    });
  });

  it('refuses an unknown transport and names the entry', () => {
    const decoded = decodeEntry(raw({ type: 'carrier-pigeon', url: 'https://a.example' }));
    expect(decoded).toMatchObject({ name: 'alpha', origin: '.mcp.json' });
    expect((decoded as { reason: string }).reason).toMatch(/unknown transport/);
  });

  it('refuses a stdio entry with no command', () => {
    expect((decodeEntry(raw({ type: 'stdio' })) as { reason: string }).reason).toMatch(
      /needs a non-empty `command`/,
    );
    expect((decodeEntry(raw({ type: 'stdio', command: '  ' })) as { reason: string }).reason).toMatch(
      /needs a non-empty `command`/,
    );
  });

  it('refuses a remote entry with no url', () => {
    for (const type of ['http', 'sse', 'ws']) {
      const decoded = decodeEntry(raw({ type })) as { reason: string };
      expect(decoded.reason).toMatch(/needs a non-empty `url`/);
    }
  });

  it('refuses a url with no type rather than reading it as stdio', () => {
    // The documented configuration error: a `url` and no `type` reads as a stdio server and then
    // fails at connection time. Refusing here says so while the file is still in front of someone.
    const decoded = decodeEntry(raw({ url: 'https://a.example' })) as { reason: string };
    expect(decoded.reason).toMatch(/declare `"type": "http"`/);
  });

  it('refuses mixed transport fields', () => {
    expect(
      (decodeEntry(raw({ type: 'stdio', command: 'x', url: 'https://a' })) as { reason: string })
        .reason,
    ).toMatch(/must not carry a `url`/);
    expect(
      (decodeEntry(raw({ type: 'http', url: 'https://a', command: 'x' })) as { reason: string })
        .reason,
    ).toMatch(/must not carry a `command`/);
    expect(
      (decodeEntry(raw({ type: 'stdio', command: 'x', headers: { a: 'b' } })) as { reason: string })
        .reason,
    ).toMatch(/must not carry `headers`/);
  });

  it('refuses non-string args, env and header values', () => {
    expect(
      (decodeEntry(raw({ type: 'stdio', command: 'x', args: ['a', 2] })) as { reason: string }).reason,
    ).toMatch(/`args` must be an array of strings/);
    expect(
      (decodeEntry(raw({ type: 'stdio', command: 'x', env: { A: 1 } })) as { reason: string }).reason,
    ).toMatch(/`env\.A` must be a string/);
    expect(
      (decodeEntry(raw({ type: 'http', url: 'https://a', headers: { A: null } })) as { reason: string })
        .reason,
    ).toMatch(/`headers\.A` must be a string/);
  });

  it('refuses a non-positive timeout', () => {
    expect(
      (decodeEntry(raw({ type: 'stdio', command: 'x', timeout: 0 })) as { reason: string }).reason,
    ).toMatch(/positive number of milliseconds/);
  });
});

describe('readRawEntries and decodeSource', () => {
  it('reports a non-object container as one problem with no entry name', () => {
    const { entries, problems } = readRawEntries('nope', 'user', 'user.json');
    expect(entries).toEqual([]);
    expect(problems).toEqual([
      { name: '', source: 'user', origin: 'user.json', reason: 'the configuration root is not an object' },
    ]);
  });

  it('accepts a bare server map as well as an mcpServers wrapper', () => {
    const wrapped = decodeSource({ mcpServers: { a: { type: 'stdio', command: 'x' } } }, 'user', 'u');
    const bare = decodeSource({ a: { type: 'stdio', command: 'x' } }, 'user', 'u');
    expect(wrapped.definitions).toHaveLength(1);
    expect(bare.definitions).toHaveLength(1);
  });

  it('keeps good entries when a sibling entry is refused', () => {
    const { definitions, problems } = decodeSource(
      { mcpServers: { good: { type: 'stdio', command: 'x' }, bad: { type: 'nope' } } },
      'project',
      '.mcp.json',
    );
    expect(definitions.map((definition) => definition.name)).toEqual(['good']);
    expect(problems.map((problem) => problem.name)).toEqual(['bad']);
  });

  it('refuses an entry that is not an object', () => {
    const { problems } = decodeSource({ mcpServers: { a: 'https://a.example' } }, 'user', 'u');
    expect(problems[0]!.reason).toMatch(/is not an object/);
  });
});
