import { describe, expect, it } from 'vitest';

import { closeObjectSchemas } from '../close-object-schemas';
import {
  STRICT_TOOL_SCHEMA_PROFILE,
  PERMISSIVE_TOOL_SCHEMA_PROFILE,
  projectToolSchema,
} from '../project-tool-schema';
import { validateAgainstJsonSchema } from '../structured-output';

import type { IParameterSchema, IToolSchema } from '../../interfaces/tool-schema';

describe('validateAgainstJsonSchema — size bounds', () => {
  it('bounds a string by its length, inclusively', () => {
    const schema: IParameterSchema = { type: 'string', minLength: 2, maxLength: 3 };

    expect(validateAgainstJsonSchema(schema, 'a', '$')).toEqual(['$: size 1 is below minLength 2']);
    expect(validateAgainstJsonSchema(schema, 'ab', '$')).toEqual([]);
    expect(validateAgainstJsonSchema(schema, 'abc', '$')).toEqual([]);
    expect(validateAgainstJsonSchema(schema, 'abcd', '$')).toEqual([
      '$: size 4 is above maxLength 3',
    ]);
  });

  it('counts characters as JSON Schema does, not UTF-16 units', () => {
    expect('😀😀'.length).toBe(4);
    expect(validateAgainstJsonSchema({ type: 'string', maxLength: 2 }, '😀😀', '$')).toEqual([]);
    expect(validateAgainstJsonSchema({ type: 'string', minLength: 3 }, '😀😀', '$')).toEqual([
      '$: size 2 is below minLength 3',
    ]);
  });

  it('bounds an array by its item count', () => {
    const schema: IParameterSchema = {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 2,
    };

    expect(validateAgainstJsonSchema(schema, [], '$')).toEqual(['$: size 0 is below minItems 1']);
    expect(validateAgainstJsonSchema(schema, ['a', 'b'], '$')).toEqual([]);
    expect(validateAgainstJsonSchema(schema, ['a', 'b', 'c'], '$')).toEqual([
      '$: size 3 is above maxItems 2',
    ]);
  });

  it('bounds an object by its property count, whether declared or additional', () => {
    const schema: IParameterSchema = {
      type: 'object',
      properties: { known: { type: 'string' } },
      additionalProperties: true,
      minProperties: 1,
      maxProperties: 2,
    };

    expect(validateAgainstJsonSchema(schema, {}, '$')).toEqual([
      '$: size 0 is below minProperties 1',
    ]);
    expect(validateAgainstJsonSchema(schema, { known: 'a', extra: 1 }, '$')).toEqual([]);
    expect(validateAgainstJsonSchema(schema, { known: 'a', x: 1, y: 2 }, '$')).toEqual([
      '$: size 3 is above maxProperties 2',
    ]);
  });

  it('bounds a free-form map, whose count is all there is to check', () => {
    const schema: IParameterSchema = { type: 'object', minProperties: 1, maxProperties: 100 };

    expect(validateAgainstJsonSchema(schema, {}, '$')).toEqual([
      '$: size 0 is below minProperties 1',
    ]);
    expect(validateAgainstJsonSchema(schema, { anything: true }, '$')).toEqual([]);
  });

  it('treats a bound of zero as a bound', () => {
    expect(validateAgainstJsonSchema({ type: 'array', maxItems: 0 }, ['a'], '$')).toEqual([
      '$: size 1 is above maxItems 0',
    ]);
    expect(validateAgainstJsonSchema({ type: 'string', minLength: 0 }, '', '$')).toEqual([]);
  });

  it('checks a bound at every depth the walk reaches', () => {
    const schema: IParameterSchema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string', minLength: 2 } },
      },
    };

    expect(validateAgainstJsonSchema(schema, { tags: ['ok', 'x'] }, '$')).toEqual([
      '$.tags[1]: size 1 is below minLength 2',
    ]);
  });

  it('checks a bound inside a union branch, so a nullable string stays bounded', () => {
    const schema: IParameterSchema = {
      anyOf: [{ type: 'string', maxLength: 3 }, { type: 'null' }],
    };

    expect(validateAgainstJsonSchema(schema, null, '$')).toEqual([]);
    expect(validateAgainstJsonSchema(schema, 'abc', '$')).toEqual([]);
    expect(validateAgainstJsonSchema(schema, 'abcd', '$')).toContain(
      '$|anyOf[0]: size 4 is above maxLength 3',
    );
  });

  it('checks a bound the union node itself declares, which applies to whichever branch matched', () => {
    const schema: IParameterSchema = {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      maxLength: 3,
    };

    expect(validateAgainstJsonSchema(schema, null, '$')).toEqual([]);
    expect(validateAgainstJsonSchema(schema, 'abc', '$')).toEqual([]);
    expect(validateAgainstJsonSchema(schema, 'abcd', '$')).toEqual([
      '$: size 4 is above maxLength 3',
    ]);
  });

  it('ignores a bound meant for another kind of value, as JSON Schema does', () => {
    expect(validateAgainstJsonSchema({ type: 'array', minLength: 5 }, [], '$')).toEqual([]);
    expect(validateAgainstJsonSchema({ type: 'string', minItems: 5 }, 'a', '$')).toEqual([]);
    expect(validateAgainstJsonSchema({ type: 'number', maxProperties: 0 }, 1, '$')).toEqual([]);
  });

  it('reports a type mismatch alone, not also a bound', () => {
    expect(validateAgainstJsonSchema({ type: 'object', minLength: 5 }, 'a', '$')).toEqual([
      '$: expected object, got string',
    ]);
  });
});

function toolWith(parameters: IToolSchema['parameters']): IToolSchema {
  return { name: 'bounded', description: 'A tool with size bounds.', parameters };
}

const BOUNDED_PROPERTIES: Record<string, IParameterSchema> = {
  query: { type: 'string', minLength: 1, maxLength: 4096 },
  tags: { type: 'array', items: { type: 'string', maxLength: 8 }, minItems: 1, maxItems: 5 },
  labels: { type: 'object', minProperties: 1, maxProperties: 9 },
  note: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
};

function keywordsAt(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return [];
  const record = node as Record<string, unknown>;
  const children = [
    ...Object.values((record.properties ?? {}) as Record<string, unknown>),
    ...(Array.isArray(record.anyOf) ? record.anyOf : []),
    ...(record.items === undefined ? [] : [record.items]),
  ];
  return [...Object.keys(record), ...children.flatMap(keywordsAt)];
}

describe('projectToolSchema — size bounds per profile', () => {
  const tool = toolWith({ type: 'object', properties: BOUNDED_PROPERTIES, required: ['query'] });
  const STRICT = { ...STRICT_TOOL_SCHEMA_PROFILE, providerName: 'strict-vendor' };
  const PERMISSIVE = { ...PERMISSIVE_TOOL_SCHEMA_PROFILE, providerName: 'open-vendor' };

  it('adopts them unchanged where the wire takes standard JSON Schema', () => {
    const projection = projectToolSchema(tool, PERMISSIVE);

    expect(projection.outcome).toBe('adopted');
    expect(projection.tool).toBe(tool);
  });

  it('leaves strict mode only the bounds it documents, at every depth', () => {
    const projection = projectToolSchema(tool, STRICT);
    const keywords = keywordsAt(projection.tool.parameters);

    expect(projection.outcome).toBe('adapted');
    for (const refused of ['minLength', 'maxLength', 'minProperties', 'maxProperties']) {
      expect(keywords, refused).not.toContain(refused);
    }
    expect(keywords).toContain('minItems');
    expect(keywords).toContain('maxItems');
  });

  it('records each strip so the Schema note names the constraint the model is not shown', () => {
    const projection = projectToolSchema(tool, STRICT);

    expect(projection.changes).toContainEqual({
      path: '/properties/query',
      kind: 'member-stripped',
      keyword: 'minLength',
    });
    expect(projection.changes).toContainEqual({
      path: '/properties/note/anyOf/0',
      kind: 'member-stripped',
      keyword: 'maxLength',
    });
    expect(projection.tool.description).toContain('Schema note:');
    expect(projection.tool.description).toContain('member-stripped@/properties/labels');
  });

  it('never touches the input, so local validation keeps the bounds the wire lost', () => {
    const projection = projectToolSchema(tool, STRICT);

    expect(projection.tool.parameters).not.toBe(tool.parameters);
    expect(validateAgainstJsonSchema(tool.parameters, { query: '' }, '$')).toEqual([
      '$.query: size 0 is below minLength 1',
    ]);
  });
});

describe('closeObjectSchemas — omitKeywords', () => {
  const schema = {
    type: 'object',
    minProperties: 1,
    properties: {
      // A parameter NAMED like a keyword is a parameter, not a keyword.
      minLength: { type: 'integer', minimum: 0 },
      query: { type: 'string', minLength: 1 },
      tags: { type: 'array', items: { type: 'string', maxLength: 8 }, minItems: 1 },
      note: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
      labels: { type: 'object', additionalProperties: { type: 'string', maxLength: 9 } },
    },
  };

  it('drops them on every route a node can arrive by, and only as keywords', () => {
    const closed = closeObjectSchemas(schema, {
      omitKeywords: ['minProperties', 'minLength', 'maxLength', 'minItems', 'minimum'],
    });

    expect(closed).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        minLength: { type: 'integer' },
        query: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        labels: { type: 'object', additionalProperties: { type: 'string' } },
      },
    });
  });

  it('leaves every keyword alone when none are named', () => {
    const closed = closeObjectSchemas(schema) as { properties: { query: unknown } };

    expect(closed.properties.query).toEqual({ type: 'string', minLength: 1 });
  });
});
