/**
 * A narrowed node carries only the values `IParameterSchema` admits, whatever the server wrote.
 *
 * Everything a server sends passes through here on its way to the validator, the provider and the
 * session record, and each of those trusts the type. `mcp-schema-session-record.test.ts` in agent-cli
 * holds the output to the record's decoder; this file states what happens to each value.
 */

import {
  PERMISSIVE_TOOL_SCHEMA_PROFILE,
  projectToolSchema,
  validateAgainstJsonSchema,
} from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../catalog/build.js';
import { createDiscoveredTool } from '../catalog/discovered-tool.js';
import { narrowToUniversalSubset } from '../third-party-schema.js';

import type { IMCPDiscovery } from '../catalog/types.js';
import type { IParameterSchema, IToolSchema, TToolParameters } from '@robota-sdk/agent-core';

function declared(node: unknown): IParameterSchema {
  return node as IParameterSchema;
}

function discoveredTool(inputSchema: unknown): ReturnType<typeof createDiscoveredTool> {
  const discovery: IMCPDiscovery = {
    identity: { serverId: 'srv', serverName: 'srv', serverVersion: '1', protocolVersion: '1' },
    tools: {
      state: { kind: 'supported', count: 1, listChanged: false },
      items: [{ name: 'tool', inputSchema: declared(inputSchema) }],
      pages: 1,
    },
    prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
  };
  const catalog = buildCatalog([
    { serverId: 'srv', origin: 'fixture', transport: 'streamable-http', discovery },
  ]);
  const entry = [...catalog.adopted, ...catalog.adapted].find((item) => item.kind === 'tool');
  if (entry?.kind !== 'tool') throw new Error('the tool did not reach the catalog');
  return createDiscoveredTool(entry, { callTool: async () => ({ content: [], isError: false }) });
}

describe('a value the subset does not admit', () => {
  it.each([
    [
      'a draft-03 required flag',
      { type: 'string', required: true },
      { type: 'string' },
      '.required',
    ],
    [
      'a non-string required member',
      { type: 'object', required: ['a', 1] },
      { type: 'object' },
      '.required',
    ],
    ['a string minimum', { type: 'number', minimum: '1' }, { type: 'number' }, '.minimum'],
    ['a null maximum', { type: 'number', maximum: null }, { type: 'number' }, '.maximum'],
    [
      'an overflowed minimum',
      { type: 'number', minimum: Infinity },
      { type: 'number' },
      '.minimum',
    ],
    ['a non-string pattern', { type: 'string', pattern: 5 }, { type: 'string' }, '.pattern'],
    [
      'a pattern from another dialect',
      { type: 'string', pattern: '(?i)abc' },
      { type: 'string' },
      '.pattern',
    ],
    ['a non-string format', { type: 'string', format: 5 }, { type: 'string' }, '.format'],
    ['array properties', { type: 'object', properties: [] }, { type: 'object' }, '.properties'],
    ['null properties', { type: 'object', properties: null }, { type: 'object' }, '.properties'],
    [
      'a string additionalProperties',
      { type: 'object', additionalProperties: 'x' },
      { type: 'object' },
      '.additionalProperties',
    ],
    [
      'a null additionalProperties',
      { type: 'object', additionalProperties: null },
      { type: 'object' },
      '.additionalProperties',
    ],
    ['a non-array enum', { type: 'string', enum: 'x' }, { type: 'string' }, '.enum'],
    ['a non-array anyOf', { type: 'string', anyOf: 'x' }, { type: 'string' }, '.anyOf'],
    [
      'a type list beside anyOf',
      { anyOf: [{ type: 'string' }], type: ['string'] },
      { anyOf: [{ type: 'string' }] },
      '.type',
    ],
  ])('%s is a lost constraint, so it is dropped and reported', (_name, input, schema, path) => {
    expect(narrowToUniversalSubset(declared(input))).toEqual({ schema, unenforceable: [path] });
  });

  it.each([
    ['an array default', { type: 'array', default: [] }, { type: 'array' }],
    ['an object default', { type: 'object', default: {} }, { type: 'object' }],
    ['a non-string description', { type: 'string', description: 5 }, { type: 'string' }],
  ])('%s constrains nothing, so it is dropped quietly', (_name, input, schema) => {
    expect(narrowToUniversalSubset(declared(input))).toEqual({ schema, unenforceable: [] });
  });

  it('leaves what the subset admits alone', () => {
    const schema = declared({
      type: 'object',
      description: 'd',
      properties: {
        a: { type: 'string', default: 'x', enum: ['x', 'y'], pattern: '^x', format: 'uri' },
        b: { type: 'number', default: 1, minimum: 0, maximum: 2 },
        c: { type: 'boolean', default: false },
        d: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        e: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['a'],
      additionalProperties: false,
    });
    expect(narrowToUniversalSubset(schema)).toEqual({ schema, unenforceable: [] });
  });
});

describe('an enum member the subset does not admit', () => {
  it('is filtered quietly under a scalar type, where it could never match', () => {
    const { schema, unenforceable } = narrowToUniversalSubset(
      declared({ type: 'string', enum: ['x', null, ['y'], { z: 1 }] }),
    );
    expect(schema).toEqual({ type: 'string', enum: ['x'] });
    expect(unenforceable).toEqual([]);
    // Exactly what the declared enum accepted: null already failed `type: 'string'`.
    expect(validateAgainstJsonSchema(schema, 'x', '')).toEqual([]);
    expect(validateAgainstJsonSchema(schema, null, '')).not.toEqual([]);
  });

  it.each([
    [
      'a union, where the member may be the accepted value',
      { anyOf: [{ type: 'string' }, { type: 'null' }], enum: ['x', null] },
      null,
    ],
    ['a null node', { type: 'null', enum: [null] }, null],
    ['an array node', { type: 'array', enum: [[1], [2]] }, [1]],
    ['an object node', { type: 'object', enum: [{ a: 1 }] }, { a: 1 }],
  ])(
    'takes the whole keyword on %s, so a value the server accepts stays accepted',
    (_name, input, accepted) => {
      const { schema, unenforceable } = narrowToUniversalSubset(declared(input));
      expect(schema).not.toHaveProperty('enum');
      expect(unenforceable).toEqual(['.enum']);
      expect(validateAgainstJsonSchema(schema, accepted, '')).toEqual([]);
    },
  );

  it('takes the whole keyword when nothing would remain, since an empty list matches nothing', () => {
    const { schema, unenforceable } = narrowToUniversalSubset(
      declared({ type: 'string', enum: [null] }),
    );
    expect(schema).toEqual({ type: 'string' });
    expect(unenforceable).toEqual(['.enum']);
  });
});

describe('a subtree the walk must reach', () => {
  it.each([
    ['items below a string', { type: 'string', items: { oneOf: [] } }, { type: 'string' }, ['[]']],
    ['tuple items', { type: 'array', items: [{ type: 'string' }] }, { type: 'array' }, ['[]']],
    ['null items', { type: 'array', items: null }, { type: 'array' }, ['[]']],
    ['boolean items', { type: 'array', items: true }, { type: 'array' }, ['[]']],
  ])('%s is dropped and reported', (_name, input, schema, paths) => {
    expect(narrowToUniversalSubset(declared(input))).toEqual({ schema, unenforceable: paths });
  });

  it('walks properties whatever the type says', () => {
    const { schema, unenforceable } = narrowToUniversalSubset(
      declared({ type: 'array', properties: { a: { oneOf: [] } } }),
    );
    expect(JSON.stringify(schema)).not.toContain('oneOf');
    expect(unenforceable).toEqual(['.a']);
  });

  it('counts a null child as inexpressible rather than throwing', () => {
    const { schema, unenforceable } = narrowToUniversalSubset(
      declared({
        type: 'object',
        properties: {
          gone: null,
          choice: { anyOf: [null, { type: 'string' }] },
        },
      }),
    );
    expect(unenforceable).toEqual(['.gone', '.choice.anyOf[0]']);
    expect(validateAgainstJsonSchema(schema, { gone: 1, choice: 1 }, '')).toEqual([]);
  });

  it('is stable: narrowing what it produced finds nothing more', () => {
    const { schema } = narrowToUniversalSubset(
      declared({
        type: 'object',
        properties: {
          a: { type: 'string', enum: ['x', null], default: [] },
          b: { type: 'array', items: { oneOf: [] }, required: true },
        },
      }),
    );
    expect(narrowToUniversalSubset(schema)).toEqual({ schema, unenforceable: [] });
  });
});

describe('`type` beside `anyOf`', () => {
  const eitherOr = declared({
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'string' } },
    anyOf: [{ required: ['a'] }, { required: ['b'] }],
  });

  it('keeps the type and reports the further constraint it loses', () => {
    const { schema, unenforceable } = narrowToUniversalSubset(eitherOr);
    expect(schema).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
    });
    expect(unenforceable).toEqual(['.anyOf']);
  });

  it('no longer costs the tool its place in the request', () => {
    const tool: IToolSchema = discoveredTool(eitherOr).schema;
    const projected = projectToolSchema(tool, {
      ...PERMISSIVE_TOOL_SCHEMA_PROFILE,
      providerName: 'test',
    });
    expect(projected.outcome).not.toBe('rejected');
  });
});

describe('what a discovered tool accepts', () => {
  const anyArguments: TToolParameters = { a: 1 };

  it.each([
    ['a root naming no properties', { type: 'object' }],
    ['a root the subset cannot express', { oneOf: [{ type: 'object' }] }],
  ])('%s stays open, since it declared no closure', (_name, root) => {
    const tool = discoveredTool(root);
    expect(tool.schema.parameters.properties).toEqual({});
    expect(tool.validateParameters(anyArguments).isValid).toBe(true);
  });

  it.each([
    ['a root closing itself', { type: 'object', additionalProperties: false }],
    ['a root declaring an empty set', { type: 'object', properties: {} }],
  ])('%s stays closed', (_name, root) => {
    expect(discoveredTool(root).validateParameters(anyArguments).isValid).toBe(false);
  });

  it('a pattern from another dialect no longer throws at validation', () => {
    const tool = discoveredTool({
      type: 'object',
      properties: { name: { type: 'string', pattern: '(?i)abc' } },
    });
    expect(tool.validateParameters({ name: 'anything' }).isValid).toBe(true);
  });
});
