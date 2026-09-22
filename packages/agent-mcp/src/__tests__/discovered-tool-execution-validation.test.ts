/**
 * MCP-005 (TC-11) — projection must never widen what execution accepts.
 *
 * `DiscoveredMCPTool` (`../catalog/discovered-tool.ts`) validates every call's arguments against the
 * CORE-040-narrowed ORIGINAL schema — untouched by this unit. The strict provider-projection profile
 * (`STRICT_TOOL_SCHEMA_PROFILE`, `agent-core`) forces an optional property into `required` and adds a
 * `null` branch (`optionalAsNullable`) so the WIRE schema a strict provider sees accepts `null` for a
 * field the original declared merely optional. That compensation is a pre-existing PROV-007 behaviour
 * this unit does not change; what TC-11 proves is that it stays confined to the wire schema and never
 * reaches `DiscoveredMCPTool`'s own validation gate: the same payload the projected schema would
 * accept is still refused by the tool's `validateParameters`.
 *
 * This is a NEW test file only — no `agent-mcp` production code changes (`git diff --stat` over
 * `packages/agent-mcp/src` lists only this file).
 */
import {
  STRICT_TOOL_SCHEMA_PROFILE,
  projectToolSchema,
  validateAgainstJsonSchema,
} from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../catalog/build.js';
import { createDiscoveredTool } from '../catalog/discovered-tool.js';

import type { IMCPCatalogToolEntry, IMCPDiscovery } from '../catalog/types.js';
import type { IMCPToolCallResult } from '../client/session.js';
import type { IParameterSchema } from '@robota-sdk/agent-core';

function okResult(): IMCPToolCallResult {
  return { content: [{ type: 'text', text: 'ran' }], isError: false };
}

function invokerReturning(): { callTool(): Promise<IMCPToolCallResult> } {
  return { callTool: async () => okResult() };
}

/** Builds one catalog tool entry the way `buildCatalog` produces it in production. */
function buildEntryFor(toolName: string, inputSchema: IParameterSchema): IMCPCatalogToolEntry {
  const discovery: IMCPDiscovery = {
    identity: {
      serverId: 'srv',
      serverName: 'srv',
      serverVersion: '1.0.0',
      protocolVersion: '2025-06-18',
    },
    tools: {
      state: { kind: 'supported', count: 1, listChanged: false },
      items: [{ name: toolName, inputSchema }],
      pages: 1,
    },
    prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
  };

  const catalog = buildCatalog([
    { serverId: 'srv', origin: 'test-fixture', transport: 'streamable-http', discovery },
  ]);
  const entry = [...catalog.adopted, ...catalog.adapted].find((e) => e.kind === 'tool');
  if (!entry || entry.kind !== 'tool') {
    throw new Error('fixture setup failed: expected exactly one tool entry');
  }
  return entry;
}

/** An optional, non-nullable `string` property — declared merely optional, not `anyOf`-nullable. */
const SCHEMA_WITH_OPTIONAL_STRING: IParameterSchema = {
  type: 'object',
  properties: {
    prop: { type: 'string' },
  },
  required: [],
};

describe('MCP-005 TC-11 — execution validation stays on the narrowed original', () => {
  const entry = buildEntryFor('optional_string', SCHEMA_WITH_OPTIONAL_STRING);
  const tool = createDiscoveredTool(entry, invokerReturning());

  it('refuses { prop: null } against the narrowed original schema', () => {
    const result = tool.validateParameters({ prop: null } as never);
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/prop/);
  });

  it('accepts the same shape without the property, and with a real string', () => {
    expect(tool.validateParameters({} as never)).toEqual({ isValid: true, errors: [] });
    expect(tool.validateParameters({ prop: 'ok' } as never)).toEqual({
      isValid: true,
      errors: [],
    });
  });

  it('the strict projection of the SAME schema accepts null for that property', () => {
    const projection = projectToolSchema(tool.schema, {
      ...STRICT_TOOL_SCHEMA_PROFILE,
      providerName: 'test-strict-provider',
    });

    expect(projection.outcome).toBe('adapted');
    const wireIssues = validateAgainstJsonSchema(projection.tool.parameters, { prop: null }, '');
    expect(wireIssues).toEqual([]);

    // The divergence this test exists to prove: the wire schema a strict provider would see widens
    // to accept `null`, but `DiscoveredMCPTool`'s own execution gate — the narrowed original, entirely
    // untouched by projection — still refuses it.
    const executionResult = tool.validateParameters({ prop: null } as never);
    expect(executionResult.isValid).toBe(false);
  });
});
