/**
 * TC-08 — a discovered tool registers through the EXISTING generic dynamic-tool contract (MCP-002).
 *
 * No MCP-specific runtime branch is added anywhere: `createDiscoveredTool` returns an ordinary
 * `IToolWithEventService`, the same slot `MCPTool` and `RelayMcpTool` already fill and that
 * `tool-006-registrable.test.ts` exercises. This file mirrors that test's assertions against the
 * catalog's own tool wrapper instead, so the registration contract is proven for BOTH producers of
 * that slot without either one needing an MCP-specific runtime branch.
 */

import { describe, expect, it, vi } from 'vitest';

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
          description: 'reads a thing',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
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
  if (!entry || entry.kind !== 'tool')
    throw new Error('fixture setup failed: expected one adopted tool');
  return entry;
}

function okResult(): IMCPToolCallResult {
  return { content: [{ type: 'text', text: 'ran' }], isError: false };
}

/** The two methods the runtime's tool intake requires beyond the narrow `ITool` (TOOL-006). */
const REQUIRED = ['getName', 'setEventService'] as const;

describe('a discovered MCP tool satisfies the runtime tool slot', () => {
  for (const method of REQUIRED) {
    it(`implements ${method}, which registration calls unconditionally`, () => {
      const tool = createDiscoveredTool(buildToolEntry(), { callTool: async () => okResult() });
      expect(typeof (tool as unknown as Record<string, unknown>)[method]).toBe('function');
    });
  }

  it('reports the CANONICAL name from getName, not the source name or a placeholder', () => {
    const entry = buildToolEntry();
    const tool = createDiscoveredTool(entry, { callTool: async () => okResult() });
    expect(tool.getName()).toBe('probe__read');
    expect(tool.getName()).toBe(entry.canonicalName);
  });

  it('schema.name matches getName — the runtime addresses the tool by this name throughout', () => {
    const tool = createDiscoveredTool(buildToolEntry(), { callTool: async () => okResult() });
    expect(tool.schema.name).toBe(tool.getName());
  });

  it('RETAINS the event service it is given, rather than accepting and discarding it', () => {
    const tool = createDiscoveredTool(buildToolEntry(), { callTool: async () => okResult() });
    const service = { emit: () => undefined } as never;
    tool.setEventService(service);
    expect((tool as unknown as { eventService?: unknown }).eventService).toBe(service);
  });

  it('accepts undefined, which is how the runtime clears the injection', () => {
    const tool = createDiscoveredTool(buildToolEntry(), { callTool: async () => okResult() });
    tool.setEventService({ emit: () => undefined } as never);
    tool.setEventService(undefined);
    expect((tool as unknown as { eventService?: unknown }).eventService).toBeUndefined();
  });

  it('registers into the SAME slot a plain object array of IToolWithEventService would use', () => {
    // No MCP-specific runtime branch: a caller that just wants "things with this shape" (what
    // `robota-initializer.ts` iterates over as `config.tools`) can hold this next to any other
    // IToolWithEventService without special-casing it.
    const tool = createDiscoveredTool(buildToolEntry(), { callTool: async () => okResult() });
    const registry: Array<{ getName(): string; setEventService(s: unknown): void }> = [tool];
    expect(registry[0]?.getName()).toBe('probe__read');
  });

  it('execute() routes to the invoker by the SOURCE name, not the canonical name', async () => {
    const callTool = vi.fn(async () => okResult());
    const tool = createDiscoveredTool(buildToolEntry(), { callTool });
    await tool.execute({ path: '/x' }, { toolName: 'probe__read', parameters: { path: '/x' } });
    expect(callTool).toHaveBeenCalledWith('read', { path: '/x' }, { signal: undefined });
  });

  it('execute() forwards the execution context signal to the invoker', async () => {
    const callTool = vi.fn(async () => okResult());
    const tool = createDiscoveredTool(buildToolEntry(), { callTool });
    const controller = new AbortController();
    await tool.execute(
      { path: '/x' },
      { toolName: 'probe__read', parameters: { path: '/x' }, signal: controller.signal },
    );
    expect(callTool).toHaveBeenCalledWith('read', { path: '/x' }, { signal: controller.signal });
  });

  it('execute() maps a successful call to success:true with the joined text content', async () => {
    const tool = createDiscoveredTool(buildToolEntry(), {
      callTool: async () => ({ content: [{ type: 'text', text: 'hello' }], isError: false }),
    });
    const result = await tool.execute({ path: '/x' }, { toolName: 'probe__read', parameters: {} });
    expect(result).toEqual({ success: true, data: 'hello' });
  });

  it('execute() prefers structuredContent over joined text when both are present', async () => {
    const tool = createDiscoveredTool(buildToolEntry(), {
      callTool: async () => ({
        content: [{ type: 'text', text: 'ignored' }],
        structuredContent: { ok: true },
        isError: false,
      }),
    });
    const result = await tool.execute({ path: '/x' }, { toolName: 'probe__read', parameters: {} });
    expect(result).toEqual({ success: true, data: { ok: true } });
  });

  it('execute() maps isError:true to success:false with an error message', async () => {
    const tool = createDiscoveredTool(buildToolEntry(), {
      callTool: async () => ({ content: [{ type: 'text', text: 'boom' }], isError: true }),
    });
    const result = await tool.execute({ path: '/x' }, { toolName: 'probe__read', parameters: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/boom/);
  });

  it('admits oversized MCP output before the generic runtime can observe it', async () => {
    const raw = 'private-output='.padEnd(130, 'x');
    const write = vi.fn().mockResolvedValue({ reference: 'tool-result:abcdefghijklmnopqrstuv' });
    const tool = createDiscoveredTool(
      buildToolEntry(),
      { callTool: async () => ({ content: [{ type: 'text', text: raw }], isError: false }) },
      {
        admission: {
          warningChars: 100,
          hardChars: 120,
          repositoryMaxChars: 200,
          spillStore: { write },
        },
      },
    );
    const result = await tool.execute({ path: '/x' }, { toolName: 'probe__read', parameters: {} });
    expect(write).toHaveBeenCalledExactlyOnceWith(raw);
    expect(result).toEqual({ success: true, data: 'tool-result:abcdefghijklmnopqrstuv' });
  });

  it('honors a catalog-validated upward limit without spilling below that limit', async () => {
    const raw = 'x'.repeat(35_000);
    const write = vi.fn();
    const entry = { ...buildToolEntry(), maxResultChars: 40_000 };
    const tool = createDiscoveredTool(
      entry,
      { callTool: async () => ({ content: [{ type: 'text', text: raw }], isError: false }) },
      { admission: { spillStore: { write } } },
    );
    const result = await tool.execute({}, { toolName: entry.canonicalName, parameters: {} });
    expect((result.data as string).length).toBe(35_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('does not expose an MCP transport error body to runtime observers', async () => {
    const tool = createDiscoveredTool(buildToolEntry(), {
      callTool: async () => Promise.reject(new Error('authorization=server-secret')),
    });
    await expect(tool.execute({}, { toolName: 'probe__read', parameters: {} })).rejects.toThrow(
      'MCP tool call failed',
    );
    try {
      await tool.execute({}, { toolName: 'probe__read', parameters: {} });
    } catch (error) {
      expect(String(error)).not.toContain('server-secret');
    }
  });

  it('validateParameters enforces the narrowed schema (required key still enforced)', () => {
    const tool = createDiscoveredTool(buildToolEntry(), { callTool: async () => okResult() });
    const result = tool.validateParameters({});
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/path/);
  });

  it('validate() accepts a conforming payload', () => {
    const tool = createDiscoveredTool(buildToolEntry(), { callTool: async () => okResult() });
    expect(tool.validate({ path: '/x' })).toBe(true);
  });
});
