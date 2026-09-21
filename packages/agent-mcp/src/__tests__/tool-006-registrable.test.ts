/**
 * TOOL-006 — an MCP tool can actually be registered as an agent tool.
 *
 * The package existed to register MCP tools with the runtime and could not: `MCPTool` and
 * `RelayMcpTool` implemented the narrow `ITool` and lacked `getName()` and `setEventService()`, while
 * the runtime's tool slot is `IToolWithEventService` and registration calls `setEventService`
 * UNCONDITIONALLY. So the failure was not only a type error a caller could cast past — casting
 * produced a `TypeError` at registration.
 *
 * These rows therefore assert the CONTRACT rather than the types. A compile-time check would have
 * passed the moment the methods existed, including if `setEventService` had been a no-op that
 * discarded the service — which satisfies the signature and defeats the reason the runtime calls it.
 */

import { describe, expect, it } from 'vitest';

import { MCPTool } from '../mcp-tool';
import { RelayMcpTool } from '../relay-mcp-tool';

const schema = {
  name: 'mcp__probe__read',
  description: 'a probe tool',
  parameters: { type: 'object' as const, properties: {}, required: [] },
};

/** The two methods the runtime's tool intake requires beyond the narrow `ITool`. */
const REQUIRED = ['getName', 'setEventService'] as const;

function mcpTool(): MCPTool {
  return new MCPTool({ isConnected: () => true } as never, schema as never);
}

function relayTool(): RelayMcpTool {
  return new RelayMcpTool({
    schema: schema as never,
    targetToolName: 'read',
    ownerPath: [],
  } as never);
}

describe('an MCP tool satisfies the runtime tool slot', () => {
  for (const [label, make] of [
    ['MCPTool', mcpTool],
    ['RelayMcpTool', relayTool],
  ] as const) {
    describe(label, () => {
      for (const method of REQUIRED) {
        it(`implements ${method}, which registration calls unconditionally`, () => {
          expect(typeof (make() as unknown as Record<string, unknown>)[method]).toBe('function');
        });
      }

      it('reports the schema name from getName, not a placeholder', () => {
        // The runtime addresses a tool by this name — permission rules, event payloads and the
        // model's own tool list all key on it. A getName returning anything else would register
        // successfully and then be unreachable by rule.
        expect(make().getName()).toBe(schema.name);
      });

      it('RETAINS the event service it is given, rather than accepting and discarding it', () => {
        // The signature is satisfied by a no-op. The contract is not: the runtime injects the
        // service so tool lifecycle events can be emitted, and a tool that drops it registers
        // cleanly while emitting nothing. This is the assertion a types-only fix would pass.
        const tool = make();
        const service = { emit: () => undefined } as never;
        tool.setEventService(service);
        expect((tool as unknown as { eventService?: unknown }).eventService).toBe(service);
      });

      it('accepts undefined, which is how the runtime clears the injection', () => {
        const tool = make();
        tool.setEventService({ emit: () => undefined } as never);
        tool.setEventService(undefined);
        expect((tool as unknown as { eventService?: unknown }).eventService).toBeUndefined();
      });
    });
  }
});
