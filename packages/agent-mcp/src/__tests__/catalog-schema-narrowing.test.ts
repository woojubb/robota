/**
 * TC-30 — CORE-040 narrowing happens at catalog registration, exactly once per tool (MCP-002).
 *
 * A discovered tool whose `inputSchema` carries a construct the runtime cannot enforce is narrowed
 * and the unenforceable construct is reported. `buildCatalog` is the successor call site the spec
 * requires now that `mcp-tool.ts` / `relay-mcp-tool.ts` are gone: it must call
 * `narrowToUniversalSubset` itself and invoke the injected reporter exactly once per affected tool,
 * with the CANONICAL name and the dropped paths.
 */

import { describe, expect, it, vi } from 'vitest';

import { buildCatalog } from '../catalog/build.js';

import type { IMCPDiscovery, IMCPServerIdentity } from '../catalog/types.js';

function identity(serverId: string): IMCPServerIdentity {
  return {
    serverId,
    serverName: `${serverId}-name`,
    serverVersion: '1.0.0',
    protocolVersion: '2025-06-18',
  };
}

function discoveryWithTools(
  serverId: string,
  items: IMCPDiscovery['tools']['items'],
): IMCPDiscovery {
  return {
    identity: identity(serverId),
    tools: {
      state: { kind: 'supported', count: items.length, listChanged: false },
      items,
      pages: 1,
    },
    prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
  };
}

describe('CORE-040 narrowing at catalog registration', () => {
  it('a tool with an inexpressible subtree is narrowed and the reporter is told once', () => {
    const report = vi.fn();
    const discovery = discoveryWithTools('srv', [
      {
        name: 'exotic',
        inputSchema: {
          type: 'object',
          properties: {
            known: { type: 'string' },
            exotic: { oneOf: [{ type: 'string' }, { type: 'number' }] } as never,
          },
          required: ['known', 'exotic'],
        },
      },
    ]);

    const catalog = buildCatalog(
      [{ serverId: 'srv', origin: 'test-fixture', transport: 'streamable-http', discovery }],
      { report },
    );

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('srv__exotic', ['.exotic']);

    const entry = [...catalog.adopted, ...catalog.adapted].find(
      (e) => e.kind === 'tool' && e.canonicalName === 'srv__exotic',
    );
    expect(entry).toBeDefined();
    if (entry?.kind === 'tool') {
      expect(entry.unenforceablePaths).toEqual(['.exotic']);
      expect(entry.disposition).toBe('adapted');
      // The stored schema is already narrowed: the exotic property is replaced with an any-value
      // node (an `anyOf` union the subset can express), not left as the raw `oneOf`.
      expect(entry.schema.properties?.exotic?.anyOf).toBeDefined();
      expect(
        (entry.schema.properties?.exotic as { oneOf?: unknown } | undefined)?.oneOf,
      ).toBeUndefined();
    }
  });

  it('a fully expressible schema reports nothing and is adopted, not adapted', () => {
    const report = vi.fn();
    const discovery = discoveryWithTools('srv', [
      {
        name: 'clean',
        inputSchema: {
          type: 'object',
          properties: { count: { type: 'integer' } },
          required: ['count'],
        },
      },
    ]);

    const catalog = buildCatalog(
      [{ serverId: 'srv', origin: 'test-fixture', transport: 'streamable-http', discovery }],
      { report },
    );

    expect(report).not.toHaveBeenCalled();
    expect(catalog.adopted).toHaveLength(1);
    const entry = catalog.adopted[0];
    if (entry.kind === 'tool') {
      expect(entry.unenforceablePaths).toEqual([]);
    }
    expect(entry.disposition).toBe('adopted');
  });

  it('narrowing and reporting run per tool: two affected tools produce two calls', () => {
    const report = vi.fn();
    const discovery = discoveryWithTools('srv', [
      {
        name: 'first',
        inputSchema: {
          type: 'object',
          properties: { a: { oneOf: [{ type: 'string' }] } as never },
          required: ['a'],
        },
      },
      {
        name: 'second',
        inputSchema: {
          type: 'object',
          properties: { b: { oneOf: [{ type: 'number' }] } as never },
          required: ['b'],
        },
      },
    ]);

    buildCatalog(
      [{ serverId: 'srv', origin: 'test-fixture', transport: 'streamable-http', discovery }],
      { report },
    );

    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith('srv__first', ['.a']);
    expect(report).toHaveBeenCalledWith('srv__second', ['.b']);
  });

  it('a tool rejected by a name collision is never narrowed and never reported', () => {
    // 'srv.a' and 'srv/a' sanitise to the SAME server prefix ('srv_a'), so the same source name
    // ('tool') on both collides after sanitisation — a real residual collision, not truncation.
    // Sort order ('.' < '/') makes 'srv.a' the winner and 'srv/a' the loser.
    const report = vi.fn();
    const winnerDiscovery = discoveryWithTools('srv.a', [
      {
        name: 'tool',
        inputSchema: {
          type: 'object',
          properties: { winnerExotic: { oneOf: [{ type: 'string' }] } as never },
          required: ['winnerExotic'],
        },
      },
    ]);
    const loserDiscovery = discoveryWithTools('srv/a', [
      {
        name: 'tool',
        inputSchema: {
          type: 'object',
          properties: { loserExotic: { oneOf: [{ type: 'number' }] } as never },
          required: ['loserExotic'],
        },
      },
    ]);

    const catalog = buildCatalog(
      [
        {
          serverId: 'srv.a',
          origin: 'test-fixture',
          transport: 'streamable-http',
          discovery: winnerDiscovery,
        },
        {
          serverId: 'srv/a',
          origin: 'test-fixture',
          transport: 'streamable-http',
          discovery: loserDiscovery,
        },
      ],
      { report },
    );

    // Exactly one report — for the WINNER's own unenforceable path. If the loser had also been
    // narrowed/reported, this would be 2.
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('srv_a__tool', ['.winnerExotic']);
    expect(catalog.rejected).toHaveLength(1);
    expect(catalog.rejected[0]).toMatchObject({ kind: 'tool', serverId: 'srv/a' });
  });

  it('report is optional: narrowing still happens with no reporter injected', () => {
    const discovery = discoveryWithTools('srv', [
      {
        name: 'exotic',
        inputSchema: {
          type: 'object',
          properties: { exotic: { oneOf: [{ type: 'string' }] } as never },
          required: ['exotic'],
        },
      },
    ]);

    const catalog = buildCatalog([
      { serverId: 'srv', origin: 'test-fixture', transport: 'streamable-http', discovery },
    ]);

    const entry = catalog.adapted[0];
    if (entry?.kind === 'tool') {
      expect(entry.unenforceablePaths).toEqual(['.exotic']);
    }
  });
});
