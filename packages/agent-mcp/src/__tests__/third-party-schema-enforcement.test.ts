/**
 * CORE-040 — an MCP tool's declared parameters must be enforced, not merely advertised.
 *
 * `MCPTool.validateParameters` and `RelayMcpTool.validateParameters` each hand-rolled the same
 * check: presence of the schema's TOP-LEVEL `required` keys, and nothing else. No types, no enums,
 * no bounds, no nested traversal. So `parameters` was a contract the model was shown and the runtime
 * did not hold — a payload with the right key names and entirely wrong values reached the handler
 * unchallenged.
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

import { MCPTool } from '../mcp-tool.js';
import { RelayMcpTool } from '../relay-mcp-tool.js';
import { narrowToUniversalSubset } from '../third-party-schema.js';

import type { IMCPConfig } from '../mcp-tool.js';
import type { IToolResult, IToolSchema } from '@robota-sdk/agent-core';

const MCP_CONFIG = { serverUrl: 'http://localhost:1/never-called' } as unknown as IMCPConfig;

function okResult(): IToolResult {
  return { success: true, data: { success: true, content: 'ran' } };
}

/** The two classes are the same defect twice; every case runs against both. */
function bothTools(
  schema: IToolSchema,
): Array<[string, { validateParameters(p: never): { isValid: boolean; errors: string[] } }]> {
  return [
    ['MCPTool', new MCPTool(MCP_CONFIG, schema) as never],
    ['RelayMcpTool', new RelayMcpTool({ schema, run: async () => okResult() }) as never],
  ];
}

const TYPED_SCHEMA: IToolSchema = {
  name: 'typed',
  description: 'declares real types the runtime must hold',
  parameters: {
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
  },
};

describe('CORE-040 — a declared type is enforced, not just advertised', () => {
  for (const [label, tool] of bothTools(TYPED_SCHEMA)) {
    it(`${label}: rejects a required key present with the wrong type`, () => {
      const result = tool.validateParameters({ count: 'three', mode: 'fast' } as never);
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/count/);
    });

    it(`${label}: rejects a value outside the declared enum`, () => {
      const result = tool.validateParameters({ count: 2, mode: 'sideways' } as never);
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/mode/);
    });

    it(`${label}: rejects a value outside the declared bounds`, () => {
      const result = tool.validateParameters({ count: 99, mode: 'fast' } as never);
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/count/);
    });

    it(`${label}: rejects a violation NESTED below the top level`, () => {
      const result = tool.validateParameters({
        count: 2,
        mode: 'fast',
        nested: { inner: 42 },
      } as never);
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/inner/);
    });

    it(`${label}: still reports a missing required key`, () => {
      const result = tool.validateParameters({ mode: 'fast' } as never);
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/count/);
    });

    it(`${label}: accepts a conforming payload`, () => {
      const result = tool.validateParameters({
        count: 2,
        mode: 'slow',
        nested: { inner: 'ok' },
      } as never);
      expect(result).toEqual({ isValid: true, errors: [] });
    });
  }
});

describe('CORE-040 — a schema the subset cannot express is narrowed, not refused', () => {
  // `oneOf` is real JSON Schema and outside the universal subset. A third-party server is entitled
  // to use it; this repo's inability to check it is not the server's error.
  const PARTLY_INEXPRESSIBLE: IToolSchema = {
    name: 'partly',
    description: 'one node the subset cannot express, next to two it can',
    parameters: {
      type: 'object',
      properties: {
        known: { type: 'string', enum: ['a', 'b'] },
        exotic: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      },
      required: ['known', 'exotic'],
    } as never,
  };

  for (const [label, tool] of bothTools(PARTLY_INEXPRESSIBLE)) {
    it(`${label}: still enforces the nodes it CAN express`, () => {
      const result = tool.validateParameters({ known: 'nope', exotic: 'anything' } as never);
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/known/);
    });

    it(`${label}: does not refuse a payload over the node it cannot express`, () => {
      // Against a naive `validateAgainstJsonSchema(inputSchema, …)` this fails with
      // "unsupported schema type" and the tool becomes uncallable.
      const result = tool.validateParameters({ known: 'a', exotic: 12345 } as never);
      expect(result).toEqual({ isValid: true, errors: [] });
    });

    it(`${label}: still requires the inexpressible key to be PRESENT`, () => {
      // Narrowing removes the type constraint, not the requirement.
      const result = tool.validateParameters({ known: 'a' } as never);
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/exotic/);
    });
  }

  it('reports the unenforceable paths rather than passing over them in silence', () => {
    const narrowed = narrowToUniversalSubset(PARTLY_INEXPRESSIBLE.parameters as never);
    expect(narrowed.unenforceable).toEqual(['.exotic']);
  });

  it('a fully expressible schema reports nothing unenforceable', () => {
    const narrowed = narrowToUniversalSubset(TYPED_SCHEMA.parameters as never);
    expect(narrowed.unenforceable).toEqual([]);
  });

  it('warns once per tool, not once per call', () => {
    const warn = vi.fn();
    const tool = new RelayMcpTool({
      schema: PARTLY_INEXPRESSIBLE,
      run: async () => okResult(),
      onUnenforceableSchema: warn,
    });

    tool.validateParameters({ known: 'a', exotic: 1 } as never);
    tool.validateParameters({ known: 'b', exotic: 2 } as never);
    tool.validateParameters({ known: 'a', exotic: 3 } as never);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('partly', ['.exotic']);
  });
});
