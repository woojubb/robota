/**
 * What MCP narrowing hands on must be what a session record can hold.
 *
 * The record is written from the tool schemas a session offered, and any decode issue makes the whole
 * record `corrupt`. So a schema narrowing passes but the codec refuses does not fail where it was
 * authored: it makes a later `--continue` lose the session. agent-mcp and agent-session state the
 * subset's value rules separately and neither can import the other, so this package, which composes
 * both, holds them to each other.
 */

import { buildCatalog, createDiscoveredTool } from '@robota-sdk/agent-mcp';
import { decodeInteractiveSessionRecord } from '@robota-sdk/agent-session';
import { describe, expect, it } from 'vitest';

import type { IParameterSchema, IToolSchema } from '@robota-sdk/agent-core';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';
import type { IMCPDiscovery } from '@robota-sdk/agent-mcp';

/** The schema a session offers for a discovered tool, by the route the CLI takes to it. */
function offeredSchema(inputSchema: IParameterSchema): IToolSchema {
  const discovery: IMCPDiscovery = {
    identity: {
      serverId: 'srv',
      serverName: 'srv',
      serverVersion: '1.0.0',
      protocolVersion: '2025-06-18',
    },
    tools: {
      state: { kind: 'supported', count: 1, listChanged: false },
      items: [{ name: 'tool', inputSchema }],
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
  return createDiscoveredTool(entry, {
    callTool: async () => ({ content: [], isError: false }),
  }).schema;
}

function recordOffering(tool: IToolSchema): IInteractiveSessionRecord {
  return {
    id: 'session-mcp-schema',
    cwd: '/work',
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
    messages: [],
    toolSchemas: [tool],
  } as IInteractiveSessionRecord;
}

function propertyOf(node: unknown): IParameterSchema {
  return { type: 'object', properties: { value: node as IParameterSchema } };
}

function nestedArrays(levels: number): unknown {
  let node: unknown = { type: 'string' };
  for (let level = 0; level < levels; level += 1) node = { type: 'array', items: node };
  return node;
}

/** Every entry is what a server may declare; none of them may cost the session its record. */
const DECLARED: readonly (readonly [string, IParameterSchema])[] = [
  ['an array default', propertyOf({ type: 'array', items: { type: 'string' }, default: [] })],
  ['an object default', propertyOf({ type: 'object', default: {} })],
  ['a null enum member', propertyOf({ type: 'string', enum: ['x', null] })],
  ['only a null enum member', propertyOf({ type: 'string', enum: [null] })],
  ['array enum members', propertyOf({ type: 'array', enum: [[1], [2]] })],
  ['an object enum member beside a union', propertyOf({ anyOf: [{ type: 'object' }], enum: [{}] })],
  ['a non-string description', propertyOf({ type: 'string', description: 5 })],
  ['a draft-03 required flag', propertyOf({ type: 'string', required: true })],
  ['a non-string required member', propertyOf({ type: 'object', required: ['a', 1] })],
  ['a string minimum', propertyOf({ type: 'number', minimum: '1' })],
  ['a null maximum', propertyOf({ type: 'number', maximum: null })],
  ['an overflowed minimum', propertyOf({ type: 'number', minimum: Number.POSITIVE_INFINITY })],
  ['a non-string pattern', propertyOf({ type: 'string', pattern: 5 })],
  ['a non-string format', propertyOf({ type: 'string', format: 5 })],
  ['array properties', propertyOf({ type: 'object', properties: [] })],
  ['null properties', propertyOf({ type: 'object', properties: null })],
  ['a null property node', propertyOf(null)],
  ['null items', propertyOf({ type: 'array', items: null })],
  ['tuple items', propertyOf({ type: 'array', items: [{ type: 'string' }] })],
  ['a string additionalProperties', propertyOf({ type: 'object', additionalProperties: 'x' })],
  ['a null additionalProperties', propertyOf({ type: 'object', additionalProperties: null })],
  ['a non-array anyOf', propertyOf({ type: 'string', anyOf: 'x' })],
  ['a null anyOf branch', propertyOf({ anyOf: [null, { type: 'string' }] })],
  ['a type list beside anyOf', propertyOf({ anyOf: [{ type: 'string' }], type: ['string'] })],
  ['items below a string', propertyOf({ type: 'string', items: { oneOf: [] } })],
  ['properties below an array', propertyOf({ type: 'array', properties: { a: { oneOf: [] } } })],
  [
    'properties beside anyOf',
    propertyOf({ anyOf: [{ type: 'object' }], properties: { a: { $ref: '#' } } }),
  ],
  ['an empty enum', propertyOf({ type: 'string', enum: [] })],
  ['an empty anyOf', propertyOf({ anyOf: [] })],
  [
    'a property named __proto__',
    JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"]}',
    ),
  ],
  ['a nesting past the ceiling', propertyOf(nestedArrays(5000))],
  ['an object root naming no properties', { type: 'object' }],
  ['a closed object root naming no properties', { type: 'object', additionalProperties: false }],
  ['a root the subset cannot express', { oneOf: [{ type: 'object' }] } as IParameterSchema],
  ['a union root', { anyOf: [{ type: 'object' }] }],
  ['a string root', { type: 'string' }],
];

describe('MCP narrowing and the session record', () => {
  it.each(DECLARED)('a record offering a tool with %s stays readable', (_name, declared) => {
    const outcome = decodeInteractiveSessionRecord(recordOffering(offeredSchema(declared)));
    expect(outcome.status === 'corrupt' ? outcome.issues : []).toEqual([]);
    expect(outcome.status).toBe('valid');
  });
});
