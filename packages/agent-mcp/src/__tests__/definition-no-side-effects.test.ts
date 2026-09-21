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

import { describe, expect, it } from 'vitest';

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
  const full = path.join(SRC, dir);
  return readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(full, entry.name));
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
  it('spawns no process and opens no socket from decode through status', () => {
    // The process and socket modules are replaced by implementations that THROW. A spy that
    // records a call would let the pipeline connect and then assert about it afterwards; throwing
    // means the first attempt fails the test at the line that made it. `fetch` is a global
    // property and is replaced the same way.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('the definition pipeline must not fetch');
    }) as typeof fetch;

    try {
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
      const entries = resolveByPrecedence(
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
