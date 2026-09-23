/**
 * CORE-040 — a discovered MCP tool's declared parameters must be enforced, not merely advertised.
 *
 * `MCPTool` and `RelayMcpTool` are gone; the catalog vertical slice (`../catalog/build.ts` +
 * `../catalog/discovered-tool.ts`) is their successor. `buildCatalog` narrows an `inputSchema`
 * ONCE, at registration (TC-30), and `createDiscoveredTool` wraps the resulting entry as a runtime
 * tool whose `validateParameters` enforces that same narrowed schema (TC-08). This file exercises
 * the CORE-040 behaviour through THAT path instead of the deleted classes.
 *
 * Both now route through `validateAgainstJsonSchema`, the single complete walk CORE-039 established.
 *
 * The trust boundary this crosses is the reason the item reserved a decision rather than assuming
 * one: an MCP `inputSchema` is authored by a THIRD-PARTY server, so it is far likelier than a
 * repo-authored schema to use a construct the universal subset cannot express. The walk REJECTS such
 * a node ("unsupported schema type"), which would refuse every payload for that tool — breaking a
 * working third-party tool over a limitation that is ours, not the server's.
 *
 * The decision, asserted below: narrow the schema to the part the subset can express, enforce THAT
 * completely, and report the unenforceable paths rather than passing over them in silence.
 */

import { describe, expect, it, vi } from 'vitest';

import { buildCatalog } from '../catalog/build.js';
import { createDiscoveredTool } from '../catalog/discovered-tool.js';
import { narrowToUniversalSubset } from '../third-party-schema.js';

import type { IMCPCatalogToolEntry, IMCPDiscovery } from '../catalog/types.js';
import type { IMCPToolCallResult } from '../client/session.js';
import type { TUnenforceableSchemaReporter } from '../third-party-schema.js';
import type { IParameterSchema, IToolResult } from '@robota-sdk/agent-core';

function okResult(): IMCPToolCallResult {
  return { content: [{ type: 'text', text: 'ran' }], isError: false };
}

function invokerReturning(): { callTool(): Promise<IMCPToolCallResult> } {
  return { callTool: async () => okResult() };
}

/**
 * Builds ONE tool entry the way `buildCatalog` produces it in production — narrowed once, at
 * registration — so this file's assertions exercise the real successor call site rather than a
 * hand-assembled fixture.
 */
function buildEntryFor(
  toolName: string,
  inputSchema: IParameterSchema,
  report?: TUnenforceableSchemaReporter,
): IMCPCatalogToolEntry {
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

  const catalog = buildCatalog(
    [{ serverId: 'srv', origin: 'test-fixture', transport: 'streamable-http', discovery }],
    { report },
  );
  const entry = [...catalog.adopted, ...catalog.adapted].find((e) => e.kind === 'tool');
  if (!entry || entry.kind !== 'tool') {
    throw new Error('fixture setup failed: expected exactly one tool entry');
  }
  return entry;
}

const TYPED_SCHEMA: IParameterSchema = {
  type: 'object',
  properties: {
    count: { type: 'integer', minimum: 1, maximum: 10 },
    mode: { type: 'string', enum: ['fast', 'slow'] },
    nested: {
      type: 'object',
      properties: { inner: { type: 'string' } },
      required: ['inner'],
    },
  },
  required: ['count', 'mode'],
};

describe('CORE-040 — a declared type is enforced, not just advertised', () => {
  const tool = createDiscoveredTool(buildEntryFor('typed', TYPED_SCHEMA), invokerReturning());

  it('rejects a required key present with the wrong type', () => {
    const result = tool.validateParameters({ count: 'three', mode: 'fast' } as never);
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/count/);
  });

  it('rejects a value outside the declared enum', () => {
    const result = tool.validateParameters({ count: 2, mode: 'sideways' } as never);
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/mode/);
  });

  it('rejects a value outside the declared bounds', () => {
    const result = tool.validateParameters({ count: 99, mode: 'fast' } as never);
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/count/);
  });

  it('rejects a violation NESTED below the top level', () => {
    const result = tool.validateParameters({
      count: 2,
      mode: 'fast',
      nested: { inner: 42 },
    } as never);
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/inner/);
  });

  it('still reports a missing required key', () => {
    const result = tool.validateParameters({ mode: 'fast' } as never);
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/count/);
  });

  it('accepts a conforming payload', () => {
    const result = tool.validateParameters({
      count: 2,
      mode: 'slow',
      nested: { inner: 'ok' },
    } as never);
    expect(result).toEqual({ isValid: true, errors: [] });
  });
});

describe('CORE-040 — a schema the subset cannot express is narrowed, not refused', () => {
  // `oneOf` is real JSON Schema and outside the universal subset. A third-party server is entitled
  // to use it; this repo's inability to check it is not the server's error.
  const PARTLY_INEXPRESSIBLE: IParameterSchema = {
    type: 'object',
    properties: {
      known: { type: 'string', enum: ['a', 'b'] },
      exotic: { oneOf: [{ type: 'string' }, { type: 'number' }] } as never,
    },
    required: ['known', 'exotic'],
  };

  const tool = createDiscoveredTool(
    buildEntryFor('partly', PARTLY_INEXPRESSIBLE),
    invokerReturning(),
  );

  it('still enforces the nodes it CAN express', () => {
    const result = tool.validateParameters({ known: 'nope', exotic: 'anything' } as never);
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/known/);
  });

  it('does not refuse a payload over the node it cannot express', () => {
    // Against a naive `validateAgainstJsonSchema(inputSchema, …)` this fails with
    // "unsupported schema type" and the tool becomes uncallable.
    const result = tool.validateParameters({ known: 'a', exotic: 12345 } as never);
    expect(result).toEqual({ isValid: true, errors: [] });
  });

  it('still requires the inexpressible key to be PRESENT', () => {
    // Narrowing removes the type constraint, not the requirement.
    const result = tool.validateParameters({ known: 'a' } as never);
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/exotic/);
  });

  it('reports the unenforceable paths rather than passing over them in silence', () => {
    const narrowed = narrowToUniversalSubset(PARTLY_INEXPRESSIBLE as never);
    expect(narrowed.unenforceable).toEqual(['.exotic']);
  });

  it('a fully expressible schema reports nothing unenforceable', () => {
    const narrowed = narrowToUniversalSubset(TYPED_SCHEMA as never);
    expect(narrowed.unenforceable).toEqual([]);
  });

  it('reports once per tool (at registration), not once per validation call', () => {
    const report = vi.fn();
    const entry = buildEntryFor('partly-reported', PARTLY_INEXPRESSIBLE, report);
    const reportedTool = createDiscoveredTool(entry, invokerReturning());

    reportedTool.validateParameters({ known: 'a', exotic: 1 } as never);
    reportedTool.validateParameters({ known: 'b', exotic: 2 } as never);
    reportedTool.validateParameters({ known: 'a', exotic: 3 } as never);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('srv__partly-reported', ['.exotic']);
  });

  it('execute() still runs normally for a tool with an unenforceable subtree', async () => {
    const entry = buildEntryFor('partly-exec', PARTLY_INEXPRESSIBLE);
    const execTool = createDiscoveredTool(entry, invokerReturning());
    const result: IToolResult = await execTool.execute(
      { known: 'a', exotic: 1 },
      { toolName: entry.canonicalName, parameters: {} },
    );
    expect(result.success).toBe(true);
  });
});
