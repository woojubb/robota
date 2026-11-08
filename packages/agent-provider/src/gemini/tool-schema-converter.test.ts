import { FunctionCallingConfigMode, Type } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { convertToolsToGeminiFormat, toGeminiFunctionCallingConfig } from './tool-schema-converter';

import type { IToolSchema } from '@robota-sdk/agent-core';

describe('toGeminiFunctionCallingConfig', () => {
  it('maps auto/none to the matching Gemini modes', () => {
    expect(toGeminiFunctionCallingConfig('auto')).toEqual({
      mode: FunctionCallingConfigMode.AUTO,
    });
    expect(toGeminiFunctionCallingConfig('none')).toEqual({
      mode: FunctionCallingConfigMode.NONE,
    });
  });

  it("maps 'required' to mode ANY (model must call some declared function)", () => {
    expect(toGeminiFunctionCallingConfig('required')).toEqual({
      mode: FunctionCallingConfigMode.ANY,
    });
  });

  it('maps a named directive to ANY constrained to that function name', () => {
    expect(toGeminiFunctionCallingConfig({ tool: 'get_weather' })).toEqual({
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: ['get_weather'],
    });
  });
});

/**
 * This mapper rebuilds every node from a fixed key list, so a subset member it does not
 * copy is dropped without a trace. `required` below the root and `anyOf` anywhere are members the
 * Gemini SDK's own `Schema` carries; omitting them told the model every nested field was optional
 * and erased union branches entirely.
 */
describe('convertToolsToGeminiFormat — nested subset members survive', () => {
  const tool: IToolSchema = {
    name: 'report',
    description: 'report',
    parameters: {
      type: 'object',
      properties: {
        report: {
          type: 'object',
          properties: { score: { type: 'number' }, note: { type: 'string' } },
          required: ['score'],
        },
        choice: {
          anyOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: { label: { type: 'string' } },
              required: ['label'],
            },
          ],
        },
      },
      required: ['report'],
    },
  };

  it('forwards a nested object required list', () => {
    const [declaration] = convertToolsToGeminiFormat([tool]);
    expect(declaration?.parameters?.properties?.['report']?.required).toEqual(['score']);
  });

  it('forwards a union node as anyOf, recursing into each branch', () => {
    const [declaration] = convertToolsToGeminiFormat([tool]);
    const choice = declaration?.parameters?.properties?.['choice'];
    expect(choice?.anyOf).toHaveLength(2);
    expect(choice?.anyOf?.[1]?.properties?.['label']?.type).toBe(Type.STRING);
    expect(choice?.anyOf?.[1]?.required).toEqual(['label']);
  });

  it('emits no type on the union node, which JSON Schema forbids beside anyOf', () => {
    const [declaration] = convertToolsToGeminiFormat([tool]);
    expect(declaration?.parameters?.properties?.['choice']?.type).toBeUndefined();
  });
});

/**
 * Gemini's `Schema` carries the subset's size bounds, typed as strings (int64 in proto3 JSON). A
 * member the fixed-list mapper does not copy is dropped without a trace, so each one is asserted.
 */
describe('convertToolsToGeminiFormat — size bounds', () => {
  it('carries a bound the root declares, since the root is mapped like any other node', () => {
    const [declaration] = convertToolsToGeminiFormat([
      {
        name: 'bounded',
        description: 'bounded',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          minProperties: 1,
          maxProperties: 2,
        },
      },
    ]);

    expect(declaration.parameters).toEqual({
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING } },
      required: ['query'],
      minProperties: '1',
      maxProperties: '2',
    });
  });

  it('carries every size bound as a string, including a bound of zero', () => {
    const [declaration] = convertToolsToGeminiFormat([
      {
        name: 'bounded',
        description: 'bounded',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', minLength: 0, maxLength: 4096 },
            tags: {
              type: 'array',
              items: { type: 'string', maxLength: 8 },
              minItems: 1,
              maxItems: 5,
            },
            labels: { type: 'object', minProperties: 1, maxProperties: 9 },
            note: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
          },
        },
      },
    ]);
    const properties = declaration.parameters?.properties ?? {};

    expect(properties['query']).toMatchObject({ minLength: '0', maxLength: '4096' });
    expect(properties['tags']).toMatchObject({
      minItems: '1',
      maxItems: '5',
      items: { maxLength: '8' },
    });
    expect(properties['labels']).toMatchObject({ minProperties: '1', maxProperties: '9' });
    expect(properties['note']).toMatchObject({ maxLength: '100', nullable: true });
  });
});

describe('a union null branch', () => {
  function convertedProperty(node: IToolSchema['parameters']['properties'][string]): unknown {
    const [declaration] = convertToolsToGeminiFormat([
      {
        name: 'tool',
        description: 'A tool.',
        parameters: { type: 'object', properties: { value: node } },
      },
    ]);
    return declaration?.parameters?.properties?.['value'];
  }

  it('becomes nullable, and the one remaining branch stands for the union', () => {
    expect(
      convertedProperty({
        description: 'Outer.',
        anyOf: [{ type: 'string', description: 'Inner.' }, { type: 'null' }],
      }),
    ).toEqual({ type: Type.STRING, description: 'Outer.', nullable: true });
  });

  it('becomes nullable beside the branches that remain', () => {
    expect(
      convertedProperty({ anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] }),
    ).toEqual({ anyOf: [{ type: Type.STRING }, { type: Type.NUMBER }], nullable: true });
  });

  it('never reaches the wire as an untyped branch, which Gemini reads as a missing field', () => {
    const anyValue = convertedProperty({
      anyOf: [
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
        { type: 'object' },
        { type: 'array', items: { type: 'string' } },
        { type: 'null' },
      ],
    }) as { anyOf: Record<string, unknown>[]; nullable: boolean };
    expect(anyValue.nullable).toBe(true);
    expect(anyValue.anyOf.every((branch) => branch['type'] !== undefined)).toBe(true);
  });

  it('leaves a union with no null branch alone', () => {
    expect(convertedProperty({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toEqual({
      anyOf: [{ type: Type.STRING }, { type: Type.NUMBER }],
    });
  });
});

describe('what Gemini refuses although JSON Schema allows it', () => {
  function declaration(parameters: IToolSchema['parameters']) {
    const [converted] = convertToolsToGeminiFormat([
      { name: 'tool', description: 'A tool.', parameters },
    ]);
    return converted;
  }
  function convertedProperty(node: unknown): unknown {
    return declaration({
      type: 'object',
      properties: { value: node as IToolSchema['parameters']['properties'][string] },
    })?.parameters?.properties?.['value'];
  }
  const NULL_ONLY = { type: Type.STRING, nullable: true };

  it.each([
    ['a null node', { type: 'null' }, NULL_ONLY],
    ['a null-only union', { anyOf: [{ type: 'null' }] }, NULL_ONLY],
    [
      'null items',
      { type: 'array', items: { type: 'null' } },
      { type: Type.ARRAY, items: NULL_ONLY },
    ],
    [
      'a branch admitting only null',
      { anyOf: [{ anyOf: [{ type: 'null' }] }, { type: 'string' }] },
      { type: Type.STRING, nullable: true },
    ],
  ])('%s reaches the wire typed', (_name, node, expected) => {
    expect(convertedProperty(node)).toEqual(expected);
  });

  it('a constraint beside anyOf leaves the branch and its own constraints standing', () => {
    expect(
      convertedProperty({ anyOf: [{ type: 'integer', minimum: 5 }, { type: 'null' }], minimum: 1 }),
    ).toEqual({ anyOf: [{ type: Type.INTEGER, minimum: 5 }], minimum: 1, nullable: true });
  });

  it('properties beside anyOf do not replace the branch that declares its own', () => {
    expect(
      convertedProperty({
        anyOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'null' },
        ],
        properties: { b: { type: 'string' } },
      }),
    ).toEqual({
      anyOf: [{ type: Type.OBJECT, properties: { a: { type: Type.STRING } }, required: ['a'] }],
      properties: { b: { type: Type.STRING } },
      nullable: true,
    });
  });

  it('a required name with no property stays off the wire', () => {
    const parameters = declaration({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a', 'undeclared', 'constructor'],
    })?.parameters;
    expect(parameters?.required).toEqual(['a']);
  });

  it('an empty required stays off the wire', () => {
    expect(
      declaration({ type: 'object', properties: { a: { type: 'string' } }, required: [] })
        ?.parameters,
    ).not.toHaveProperty('required');
  });

  it('a tool with no parameters declares none', () => {
    expect(declaration({ type: 'object', properties: {} })).toEqual({
      name: 'tool',
      description: 'A tool.',
    });
  });

  it('a root with no properties at all, which only the type forbids, declares none either', () => {
    expect(declaration({ type: 'object' } as IToolSchema['parameters'])).toEqual({
      name: 'tool',
      description: 'A tool.',
    });
  });

  it('a nested object leaves an empty properties off the wire', () => {
    expect(convertedProperty({ type: 'object', properties: {} })).toEqual({ type: Type.OBJECT });
  });
});
