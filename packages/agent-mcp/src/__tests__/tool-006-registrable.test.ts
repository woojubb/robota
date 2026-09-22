/**
 * TOOL-006 — an MCP tool can actually be registered as an agent tool.
 *
 * The package existed to register MCP tools with the runtime and could not: the hand-written
 * `MCPTool`/`RelayMcpTool` stack implemented the narrow `ITool` and lacked `getName()` and
 * `setEventService()`, while the runtime's tool slot is `IToolWithEventService` and registration
 * calls `setEventService` UNCONDITIONALLY. So the failure was not only a type error a caller could
 * cast past — casting produced a `TypeError` at registration.
 *
 * These rows therefore assert the CONTRACT rather than the types. A compile-time check would have
 * passed the moment the methods existed, including if `setEventService` had been a no-op that
 * discarded the service — which satisfies the signature and defeats the reason the runtime calls it.
 *
 * MCP-002 removed the hand-written `MCPTool`/`RelayMcpTool` stack; `createDiscoveredTool`
 * (`../catalog/discovered-tool.js`) is now the one producer of this runtime tool slot, so there is
 * no second class left to parametrise this suite over.
 */

import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../catalog/build.js';
import { createDiscoveredTool } from '../catalog/discovered-tool.js';

import type { IMCPCatalogToolEntry, IMCPDiscovery, IMCPServerIdentity } from '../catalog/types.js';
import type { IMCPToolCallResult } from '../client/session.js';

function identity(serverId: string): IMCPServerIdentity {
  return {
    serverId,
    serverName: `${serverId}-name`,
    serverVersion: '1.0.0',
    protocolVersion: '2025-06-18',
  };
}

function buildToolEntry(): IMCPCatalogToolEntry {
  const discovery: IMCPDiscovery = {
    identity: identity('probe'),
    tools: {
      state: { kind: 'supported', count: 1, listChanged: false },
      items: [
        {
          name: 'read',
          description: 'a probe tool',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
      ],
      pages: 1,
    },
    prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
  };

  const catalog = buildCatalog([
    { serverId: 'probe', origin: 'test-fixture', transport: 'streamable-http', discovery },
  ]);
  const entry = catalog.adopted[0];
  if (!entry || entry.kind !== 'tool') {
    throw new Error('fixture setup failed: expected one adopted tool');
  }
  return entry;
}

function okResult(): IMCPToolCallResult {
  return { content: [{ type: 'text', text: 'ran' }], isError: false };
}

function makeTool() {
  return createDiscoveredTool(buildToolEntry(), { callTool: async () => okResult() });
}

/** The two methods the runtime's tool intake requires beyond the narrow `ITool`. */
const REQUIRED = ['getName', 'setEventService'] as const;

describe('an MCP tool satisfies the runtime tool slot', () => {
  for (const method of REQUIRED) {
    it(`implements ${method}, which registration calls unconditionally`, () => {
      expect(typeof (makeTool() as unknown as Record<string, unknown>)[method]).toBe('function');
    });
  }

  it('reports the schema name from getName, not a placeholder', () => {
    // The runtime addresses a tool by this name — permission rules, event payloads and the
    // model's own tool list all key on it. A getName returning anything else would register
    // successfully and then be unreachable by rule.
    const tool = makeTool();
    expect(tool.getName()).toBe(tool.schema.name);
    expect(tool.getName()).toBe('probe__read');
  });

  it('RETAINS the event service it is given, rather than accepting and discarding it', () => {
    // The signature is satisfied by a no-op. The contract is not: the runtime injects the
    // service so tool lifecycle events can be emitted, and a tool that drops it registers
    // cleanly while emitting nothing. This is the assertion a types-only fix would pass.
    const tool = makeTool();
    const service = { emit: () => undefined } as never;
    tool.setEventService(service);
    expect((tool as unknown as { eventService?: unknown }).eventService).toBe(service);
  });

  it('accepts undefined, which is how the runtime clears the injection', () => {
    const tool = makeTool();
    tool.setEventService({ emit: () => undefined } as never);
    tool.setEventService(undefined);
    expect((tool as unknown as { eventService?: unknown }).eventService).toBeUndefined();
  });
});
