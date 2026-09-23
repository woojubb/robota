/**
 * TC-04 — capability state is three-valued (MCP-002).
 *
 * A server declaring no `prompts` capability yields `unsupported` and is NEVER called; a server
 * declaring `prompts` with zero items yields `supported/empty`; the two are distinguishable in the
 * catalog. Built from discovery INPUTS only — no network, nothing "called".
 */

import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../catalog/build.js';

import type { IMCPCatalogInput } from '../catalog/build.js';
import type { IMCPDiscovery, IMCPServerIdentity } from '../catalog/types.js';

function identity(serverId: string): IMCPServerIdentity {
  return {
    serverId,
    serverName: `${serverId}-name`,
    serverVersion: '1.0.0',
    protocolVersion: '2025-06-18',
  };
}

/** A discovery where `prompts` was never declared — `unsupported`, and `resources` is `supported/0`. */
function discoveryWithMixedCapabilities(serverId: string): IMCPDiscovery {
  return {
    identity: identity(serverId),
    tools: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    resources: { state: { kind: 'supported', count: 0, listChanged: false }, items: [], pages: 1 },
  };
}

describe('capability state is three-valued and distinguishable', () => {
  it('a capability the server never declared is unsupported', () => {
    const catalog = buildCatalog([
      {
        serverId: 'srv',
        origin: 'test-fixture',
        transport: 'streamable-http',
        discovery: discoveryWithMixedCapabilities('srv'),
      },
    ]);

    const server = catalog.servers.find((s) => s.serverId === 'srv');
    expect(server?.capabilities.prompts).toEqual({ kind: 'unsupported' });
  });

  it('a capability declared with zero items is supported/empty, not unsupported', () => {
    const catalog = buildCatalog([
      {
        serverId: 'srv',
        origin: 'test-fixture',
        transport: 'streamable-http',
        discovery: discoveryWithMixedCapabilities('srv'),
      },
    ]);

    const server = catalog.servers.find((s) => s.serverId === 'srv');
    expect(server?.capabilities.resources).toEqual({
      kind: 'supported',
      count: 0,
      listChanged: false,
    });
  });

  it('unsupported and supported/empty are distinguishable — neither collapses to the other', () => {
    const catalog = buildCatalog([
      {
        serverId: 'srv',
        origin: 'test-fixture',
        transport: 'streamable-http',
        discovery: discoveryWithMixedCapabilities('srv'),
      },
    ]);

    const server = catalog.servers.find((s) => s.serverId === 'srv');
    expect(server?.capabilities.prompts.kind).not.toBe(server?.capabilities.resources.kind);
    expect(server?.capabilities.prompts.kind).toBe('unsupported');
    expect(server?.capabilities.resources.kind).toBe('supported');
  });

  it('an unsupported domain contributes NO catalog entries — it is never "called"', () => {
    const catalog = buildCatalog([
      {
        serverId: 'srv',
        origin: 'test-fixture',
        transport: 'streamable-http',
        discovery: discoveryWithMixedCapabilities('srv'),
      },
    ]);

    // prompts is unsupported: no adopted/adapted/rejected prompt entries can exist for it, because
    // this builder only ever iterates `discovery.<domain>.items` when `state.kind === 'supported'`.
    const promptEntries = [...catalog.adopted, ...catalog.adapted].filter(
      (entry) => entry.kind === 'prompt',
    );
    expect(promptEntries).toEqual([]);
  });

  it('a server never opened (no discovery) reports every capability as unsupported, no identity', () => {
    const catalog = buildCatalog([
      { serverId: 'never-opened', origin: 'test-fixture', transport: 'stdio' },
    ]);

    const server = catalog.servers.find((s) => s.serverId === 'never-opened');
    expect(server?.identity).toBeUndefined();
    expect(server?.capabilities).toEqual({
      tools: { kind: 'unsupported' },
      prompts: { kind: 'unsupported' },
      resources: { kind: 'unsupported' },
    });
  });

  it('supported with a non-zero count is also distinguishable from supported/empty', () => {
    const discovery: IMCPDiscovery = {
      identity: identity('srv2'),
      tools: {
        state: { kind: 'supported', count: 1, listChanged: false },
        items: [{ name: 'ping', inputSchema: { type: 'object', properties: {} } }],
        pages: 1,
      },
      prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
      resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    };
    const catalog = buildCatalog([
      { serverId: 'srv2', origin: 'test-fixture', transport: 'streamable-http', discovery },
    ]);

    const server = catalog.servers.find((s) => s.serverId === 'srv2');
    expect(server?.capabilities.tools).toEqual({ kind: 'supported', count: 1, listChanged: false });
    expect(catalog.adopted.some((entry) => entry.kind === 'tool')).toBe(true);
  });
});
