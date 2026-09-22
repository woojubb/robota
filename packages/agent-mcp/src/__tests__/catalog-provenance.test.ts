/**
 * TC-18 — every catalog entry carries its provenance, and adopted/adapted are both populated
 * (MCP-002).
 *
 * Every entry carries its originating server id, the negotiated `protocolVersion` and
 * `serverInfo.version`. `adopted` and `adapted` are both populated with reasons — not only
 * `rejected` — and `adapted` names WHAT changed (renamed / truncated / narrowed).
 */

import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../catalog/build.js';

import type { IMCPDiscovery, IMCPServerIdentity } from '../catalog/types.js';

function identity(serverId: string): IMCPServerIdentity {
  return {
    serverId,
    serverName: `${serverId}-name`,
    serverVersion: '9.9.9',
    protocolVersion: '2025-06-18',
  };
}

describe('catalog provenance', () => {
  it('an adopted tool (clean name, fully expressible schema) carries full provenance, no reason', () => {
    const discovery: IMCPDiscovery = {
      identity: identity('srv'),
      tools: {
        state: { kind: 'supported', count: 1, listChanged: false },
        items: [
          {
            name: 'ping',
            description: 'pings',
            inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
          },
        ],
        pages: 1,
      },
      prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
      resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    };

    const catalog = buildCatalog([
      { serverId: 'srv', origin: '/definitions/srv.json', transport: 'streamable-http', discovery },
    ]);

    expect(catalog.adopted).toHaveLength(1);
    const entry = catalog.adopted[0];
    expect(entry.disposition).toBe('adopted');
    expect(entry.reason).toBeUndefined();
    expect(entry.provenance).toEqual({
      serverId: 'srv',
      serverName: 'srv-name',
      serverVersion: '9.9.9',
      protocolVersion: '2025-06-18',
      origin: '/definitions/srv.json',
    });
  });

  it('an adapted tool (renamed) names "renamed" as the reason and still carries provenance', () => {
    const discovery: IMCPDiscovery = {
      identity: identity('srv'),
      tools: {
        state: { kind: 'supported', count: 1, listChanged: false },
        items: [
          {
            name: 'do thing!',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
        pages: 1,
      },
      prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
      resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    };

    const catalog = buildCatalog([
      { serverId: 'srv', origin: '/definitions/srv.json', transport: 'streamable-http', discovery },
    ]);

    expect(catalog.adopted).toEqual([]);
    expect(catalog.adapted).toHaveLength(1);
    const entry = catalog.adapted[0];
    expect(entry.disposition).toBe('adapted');
    expect(entry.reason).toBe('renamed');
    expect(entry.provenance.serverId).toBe('srv');
    expect(entry.provenance.protocolVersion).toBe('2025-06-18');
    expect(entry.provenance.serverVersion).toBe('9.9.9');
  });

  it('an adapted tool (narrowed schema) names "narrowed" as the reason', () => {
    const discovery: IMCPDiscovery = {
      identity: identity('srv'),
      tools: {
        state: { kind: 'supported', count: 1, listChanged: false },
        items: [
          {
            name: 'exotic',
            inputSchema: {
              type: 'object',
              properties: { value: { oneOf: [{ type: 'string' }, { type: 'number' }] } as never },
              required: ['value'],
            },
          },
        ],
        pages: 1,
      },
      prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
      resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    };

    const catalog = buildCatalog([
      { serverId: 'srv', origin: '/definitions/srv.json', transport: 'streamable-http', discovery },
    ]);

    expect(catalog.adapted).toHaveLength(1);
    expect(catalog.adapted[0].reason).toBe('narrowed');
  });

  it('a prompt and a resource entry also carry full provenance', () => {
    const discovery: IMCPDiscovery = {
      identity: identity('srv'),
      tools: { state: { kind: 'unsupported' }, items: [], pages: 0 },
      prompts: {
        state: { kind: 'supported', count: 1, listChanged: false },
        items: [{ name: 'greeting' }],
        pages: 1,
      },
      resources: {
        state: { kind: 'supported', count: 1, listChanged: false },
        items: [{ uri: 'file:///a.txt', name: 'a' }],
        pages: 1,
      },
    };

    const catalog = buildCatalog([
      { serverId: 'srv', origin: '/definitions/srv.json', transport: 'stdio', discovery },
    ]);

    const kinds = catalog.adopted.map((entry) => entry.kind).sort();
    expect(kinds).toEqual(['prompt', 'resource']);
    for (const entry of catalog.adopted) {
      expect(entry.provenance.serverId).toBe('srv');
      expect(entry.provenance.protocolVersion).toBe('2025-06-18');
      expect(entry.provenance.serverVersion).toBe('9.9.9');
    }
  });

  it('both adopted and adapted are populated in the same catalog, not only rejected', () => {
    const discovery: IMCPDiscovery = {
      identity: identity('srv'),
      tools: {
        state: { kind: 'supported', count: 2, listChanged: false },
        items: [
          { name: 'clean', inputSchema: { type: 'object', properties: {} } },
          { name: 'needs fixing!', inputSchema: { type: 'object', properties: {} } },
        ],
        pages: 1,
      },
      prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
      resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    };

    const catalog = buildCatalog([
      { serverId: 'srv', origin: '/definitions/srv.json', transport: 'streamable-http', discovery },
    ]);

    expect(catalog.adopted.length).toBeGreaterThan(0);
    expect(catalog.adapted.length).toBeGreaterThan(0);
  });
});
