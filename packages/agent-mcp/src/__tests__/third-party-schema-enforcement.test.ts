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

import { FunctionTool, ToolRegistry, validateAgainstJsonSchema } from '@robota-sdk/agent-core';
import { describe, expect, it, vi } from 'vitest';

import { buildCatalog } from '../catalog/build.js';
import { createDiscoveredTool } from '../catalog/discovered-tool.js';
import { narrowToUniversalSubset } from '../third-party-schema.js';

import type { IMCPCatalogToolEntry, IMCPDiscovery } from '../catalog/types.js';
import type { IMCPToolCallResult } from '../client/session.js';
import type { TUnenforceableSchemaReporter } from '../third-party-schema.js';
import type { IObjectParameterSchema, IParameterSchema, IToolResult } from '@robota-sdk/agent-core';

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

describe('a discovered tool enforces the size bounds its server declares', () => {
  // The shape Exa `web_search_exa` declares.
  const SEARCH_SCHEMA = {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1 },
      objective: { type: 'string', minLength: 1, maxLength: 4096 },
    },
    required: ['query', 'objective'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  } as unknown as IParameterSchema;

  it('has nothing to report at registration', () => {
    const report = vi.fn();

    buildEntryFor('search', SEARCH_SCHEMA, report);

    expect(report).not.toHaveBeenCalled();
  });

  it('refuses an empty query and an over-long objective, and accepts what is inside the bounds', () => {
    const tool = createDiscoveredTool(buildEntryFor('search', SEARCH_SCHEMA), invokerReturning());

    expect(tool.validateParameters({ query: '', objective: 'a' }).errors).toEqual([
      '.query: size 0 is below minLength 1',
    ]);
    expect(tool.validateParameters({ query: 'a', objective: 'a'.repeat(4097) }).errors).toEqual([
      '.objective: size 4097 is above maxLength 4096',
    ]);
    expect(tool.validateParameters({ query: 'a', objective: 'a'.repeat(4096) })).toEqual({
      isValid: true,
      errors: [],
    });
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

describe('narrowing projects every node onto the subset keywords', () => {
  const SUBSET_KEYS = new Set([
    'type',
    'description',
    'enum',
    'items',
    'properties',
    'required',
    'anyOf',
    'additionalProperties',
    'minimum',
    'maximum',
    'pattern',
    'format',
    'default',
  ]);

  function keysOutsideSubset(node: unknown, path = ''): string[] {
    if (typeof node !== 'object' || node === null) return [];
    const schema = node as Record<string, unknown>;
    const own = Object.keys(schema)
      .filter((key) => !SUBSET_KEYS.has(key))
      .map((key) => `${path}.${key}`);
    const properties = (schema['properties'] ?? {}) as Record<string, unknown>;
    return [
      ...own,
      ...Object.entries(properties).flatMap(([key, child]) =>
        keysOutsideSubset(child, `${path}.${key}`),
      ),
      ...keysOutsideSubset(schema['items'], `${path}[]`),
      ...((schema['anyOf'] as unknown[] | undefined) ?? []).flatMap((child, index) =>
        keysOutsideSubset(child, `${path}.anyOf[${index}]`),
      ),
      ...(typeof schema['additionalProperties'] === 'object'
        ? keysOutsideSubset(schema['additionalProperties'], `${path}.additionalProperties`)
        : []),
    ];
  }

  it('drops a constraint the subset cannot check and reports it, so the copy stays inside the contract', () => {
    const declared = {
      type: 'object',
      properties: {
        count: { type: 'integer', multipleOf: 2, description: 'an even count' },
        tags: { type: 'array', items: { type: 'string', const: 'a' }, uniqueItems: true },
      },
      required: ['count'],
      additionalProperties: false,
    } as unknown as IParameterSchema;

    const { schema, unenforceable } = narrowToUniversalSubset(declared);

    expect(keysOutsideSubset(schema)).toEqual([]);
    expect(unenforceable).toEqual(['.count.multipleOf', '.tags.uniqueItems', '.tags[].const']);
    expect(schema.required).toEqual(['count']);
    expect(schema.properties?.['count']).toEqual({ type: 'integer', description: 'an even count' });
  });

  it('keeps a size bound and enforces it, so the shape Exa declares has nothing to report', () => {
    const declared = {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        objective: { type: 'string', minLength: 1, maxLength: 4096 },
        tags: { type: 'array', items: { type: 'string', minLength: 2 }, minItems: 1, maxItems: 2 },
        labels: { type: 'object', minProperties: 1, maxProperties: 2 },
      },
      required: ['query', 'objective'],
      additionalProperties: false,
    } as unknown as IParameterSchema;

    const { schema, unenforceable } = narrowToUniversalSubset(declared);

    expect(unenforceable).toEqual([]);
    expect(schema).toEqual(declared);
    expect(validateAgainstJsonSchema(schema, { query: '', objective: 'a' }, '')).toEqual([
      '.query: size 0 is below minLength 1',
    ]);
    expect(
      validateAgainstJsonSchema(schema, { query: 'a', objective: 'a'.repeat(4097) }, ''),
    ).toEqual(['.objective: size 4097 is above maxLength 4096']);
    expect(validateAgainstJsonSchema(schema, { query: 'a', objective: 'a', tags: [] }, '')).toEqual(
      ['.tags: size 0 is below minItems 1'],
    );
    expect(
      validateAgainstJsonSchema(schema, { query: 'a', objective: 'a', labels: {} }, ''),
    ).toEqual(['.labels: size 0 is below minProperties 1']);
  });

  it('keeps a size bound inside a union branch, the nullable shape Pydantic emits', () => {
    const declared = {
      type: 'object',
      properties: {
        client_model: {
          anyOf: [{ maxLength: 100, type: 'string' }, { type: 'null' }],
          default: null,
        },
      },
    } as unknown as IParameterSchema;

    const { schema, unenforceable } = narrowToUniversalSubset(declared);

    expect(unenforceable).toEqual([]);
    expect(validateAgainstJsonSchema(schema, { client_model: null }, '')).toEqual([]);
    expect(
      validateAgainstJsonSchema(schema, { client_model: 'a'.repeat(101) }, '').join(' '),
    ).toContain('size 101 is above maxLength 100');
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['textual', '1'],
    ['null', null],
  ])(
    'drops and reports a %s size bound, which could be neither checked nor persisted',
    (_label, bound) => {
      const declared = {
        type: 'object',
        properties: { query: { type: 'string', minLength: bound, maxLength: 9 } },
      } as unknown as IParameterSchema;

      const { schema, unenforceable } = narrowToUniversalSubset(declared);

      expect(unenforceable).toEqual(['.query.minLength']);
      expect(schema.properties?.['query']).toEqual({ type: 'string', maxLength: 9 });
    },
  );

  it('replaces an inexpressible union branch, so the tool still registers and accepts the value', () => {
    // The shape Parallel `web_decisions.advanced_settings` declares. Stripping `$ref` used to leave
    // `{}` in the union, which registration refuses: with that server connected, every turn failed.
    const declared = {
      type: 'object',
      properties: {
        advanced_settings: {
          anyOf: [{ $ref: '#/$defs/AdvancedDecisionSettings' }, { type: 'null' }],
          default: null,
        },
      },
      $defs: { AdvancedDecisionSettings: { type: 'object' } },
    } as unknown as IObjectParameterSchema;

    const { schema, unenforceable } = narrowToUniversalSubset(declared);

    expect(unenforceable).toEqual(['.advanced_settings.anyOf[0]']);
    expect(
      validateAgainstJsonSchema(schema, { advanced_settings: { location: 'us' } }, ''),
    ).toEqual([]);
    expect(validateAgainstJsonSchema(schema, { advanced_settings: null }, '')).toEqual([]);
    expect(() =>
      new ToolRegistry().register(
        new FunctionTool(
          { name: 'decide', description: 'decide', parameters: schema as IObjectParameterSchema },
          async () => 'ran',
        ),
      ),
    ).not.toThrow();
  });

  it('drops annotations without reporting them, since they constrain nothing', () => {
    const declared = {
      type: 'object',
      title: 'Search',
      $comment: 'generated',
      properties: {
        q: { type: 'string', title: 'Query', examples: ['robota'], deprecated: false },
      },
    } as unknown as IParameterSchema;

    const { schema, unenforceable } = narrowToUniversalSubset(declared);

    expect(unenforceable).toEqual([]);
    expect(schema).toEqual({ type: 'object', properties: { q: { type: 'string' } } });
  });
});
