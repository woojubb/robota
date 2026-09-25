/**
 * TC-05 — parse, import, resolve, list, get and status open no socket and spawn no process.
 *
 * ADR-005 states this as a property of the control plane, and a property nothing checks is a
 * comment. Two checks, because either alone passes for the wrong reason:
 *
 * 1. A STATIC assertion over the pure directories' imports. A behavioural test only proves the
 *    paths it happened to walk; the import graph is what makes a later `undici` import visible in
 *    review rather than at runtime.
 * 2. A BEHAVIOURAL assertion that the whole pipeline, driven end to end, spawns nothing and
 *    connects nowhere — because a module can reach the network through a transitive import the
 *    static list does not name.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// Replaced for the behavioural case below, and replaced with THROWING implementations rather than
// spies: a spy records the call and lets the pipeline connect, so the assertion happens after the
// thing it forbids already happened. These must be hoisted, hence `vi.mock` at module scope.
const forbid = (name: string) => () => {
  throw new Error(`the definition pipeline must not call ${name}`);
};
vi.mock('node:child_process', () => ({
  spawn: forbid('child_process.spawn'),
  spawnSync: forbid('child_process.spawnSync'),
  exec: forbid('child_process.exec'),
  execSync: forbid('child_process.execSync'),
  execFile: forbid('child_process.execFile'),
  fork: forbid('child_process.fork'),
}));
vi.mock('node:net', () => ({
  connect: forbid('net.connect'),
  createConnection: forbid('net.createConnection'),
  Socket: forbid('net.Socket'),
}));
vi.mock('node:tls', () => ({ connect: forbid('tls.connect') }));
vi.mock('node:http', () => ({ request: forbid('http.request'), get: forbid('http.get') }));
vi.mock('node:https', () => ({ request: forbid('https.request'), get: forbid('https.get') }));

import { decodeSource } from '../definition/decode.js';
import { materializeDefinition } from '../definition/env-template.js';
import { applyDisableOverlay } from '../definition/overlay.js';
import { resolveByPrecedence } from '../definition/precedence.js';
import { MCPDefinitionRegistry } from '../definition/registry.js';
import { getServer, listServers, statusOf } from '../management/results.js';

import type { IMCPServerDefinition } from '../definition/types.js';

const PURE_DIRS = ['definition', 'management'];
const SRC = path.resolve(import.meta.dirname, '..');

/** Modules that can start a process or open a connection. */
const FORBIDDEN =
  /^(node:)?(child_process|net|tls|http|https|http2|dgram|worker_threads|cluster|dns|undici|ws|node-fetch|axios|@modelcontextprotocol\/sdk)/;

function sourceFiles(dir: string): string[] {
  // RECURSIVE. A non-recursive listing left a future `definition/<subdir>/` uncovered while the
  // "finds the directories it claims to check" case below still passed — a guard that reports
  // clean over a corpus it never walked.
  const full = path.join(SRC, dir);
  const out: string[] = [];
  for (const entry of readdirSync(full, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    out.push(path.join(entry.parentPath ?? full, entry.name));
  }
  return out;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)[^;]*?from\s+'([^']+)'/g)) {
    specifiers.push(match[1]!);
  }
  for (const match of text.matchAll(/\bimport\(\s*'([^']+)'/g)) specifiers.push(match[1]!);
  for (const match of text.matchAll(/\brequire\(\s*'([^']+)'/g)) specifiers.push(match[1]!);
  return specifiers;
}

describe('the pure pipeline imports nothing that can connect or spawn', () => {
  it('finds the directories it claims to check', () => {
    // Without this, deleting a directory would make the assertion below vacuously true.
    for (const dir of PURE_DIRS) expect(sourceFiles(dir).length).toBeGreaterThan(0);
  });

  it.each(PURE_DIRS)('%s/ imports no process, socket or MCP-SDK module', (dir) => {
    const offenders: string[] = [];
    for (const file of sourceFiles(dir)) {
      for (const specifier of importsOf(file)) {
        if (FORBIDDEN.test(specifier)) {
          offenders.push(`${path.relative(SRC, file)} imports ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('would catch a forbidden import if one appeared', () => {
    // The guard's own red-proof: the matcher is what the assertion rests on.
    expect(FORBIDDEN.test('node:child_process')).toBe(true);
    expect(FORBIDDEN.test('undici')).toBe(true);
    expect(FORBIDDEN.test('@modelcontextprotocol/sdk/client/index.js')).toBe(true);
    expect(FORBIDDEN.test('./types.js')).toBe(false);
    expect(FORBIDDEN.test('node:crypto')).toBe(false);
  });
});

describe('driving the whole pipeline contacts nothing', () => {
  it('spawns no process and opens no socket from decode through status', async () => {
    // `node:child_process`, `node:net`, `node:tls`, `node:http` and `node:https` are replaced at
    // module scope above by implementations that THROW; `fetch` is a global property and is
    // replaced here the same way. An earlier version of this case replaced only `fetch` and then
    // leaned on `process.getActiveResourcesInfo()`, which is empty after a `spawnSync`, after a
    // child that already exited, and after a socket that connected and closed — so it would have
    // passed over a pipeline that spawned a helper or connected, read and hung up.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('the definition pipeline must not fetch');
    }) as typeof fetch;

    try {
      // The guard's own red-proof, INSIDE the try: if the module replacement were not in effect,
      // every assertion below would pass over a pipeline free to spawn and connect — and if one of
      // these three fails, the `finally` still restores `fetch` instead of leaking the stub into
      // the rest of the file.
      const childProcess = await import('node:child_process');
      const net = await import('node:net');
      expect(() => childProcess.spawn('true')).toThrow(/must not call child_process.spawn/);
      expect(() => net.connect(1)).toThrow(/must not call net.connect/);
      expect(() => globalThis.fetch('https://example.test')).toThrow(/must not fetch/);

      const decoded = decodeSource(
        {
          mcpServers: {
            alpha: {
              type: 'http',
              url: 'https://${HOST}/mcp',
              headers: { Authorization: 'Bearer ${TOKEN}' },
            },
            beta: { type: 'stdio', command: 'python', args: ['server.py'] },
            broken: { url: 'https://nowhere.example' },
          },
        },
        'project',
        '.mcp.json',
      );
      const { entries } = resolveByPrecedence(
        [{ source: 'project', origin: '.mcp.json', ...decoded }],
        (definition: IMCPServerDefinition) =>
          materializeDefinition(definition, { HOST: 'api.example' }),
      );
      const overlaid = applyDisableOverlay(entries, { disabled: { beta: 'paused' } });

      // Every management path the spec names, driven end to end over a fixture that contains a
      // remote server, a stdio server and a malformed entry.
      const listed = listServers(overlaid);
      const got = getServer(overlaid, 'alpha');
      const status = statusOf(overlaid);
      const requests = new MCPDefinitionRegistry(overlaid).list();

      expect(listed.servers).toHaveLength(3);
      expect(got.found).toBe(true);
      expect(status.unresolved).toBe(1);
      expect(requests.map((request) => request.serverId)).toEqual(['alpha']);

      // Nothing was created: no child process and no socket exist for this run to have opened.
      const active = process.getActiveResourcesInfo();
      expect(active.filter((resource) => resource === 'ChildProcess')).toEqual([]);
      expect(active.filter((resource) => resource === 'TCPSocketWrap')).toEqual([]);
      expect(active.filter((resource) => resource === 'TLSWrap')).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
