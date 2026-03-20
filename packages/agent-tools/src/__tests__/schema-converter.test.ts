import { describe, it, expect } from 'vitest';
import type { IZodSchema, IZodSchemaDef } from '../implementations/function-tool/types';
import {
  zodToJsonSchema,
  extractEnumValues,
  hasValidationConstraints,
  getSchemaTypeName,
} from '../implementations/function-tool/schema-converter';

/**
 * Create a mock Zod schema definition.
 * This simulates Zod's internal _def structure without importing Zod itself.
 */
function mockZodSchema(def: IZodSchemaDef): IZodSchema {
  return {
    parse: (value) => value,
    safeParse: (value) => ({ success: true, data: value }),
    _def: def,
  };
}

/**
 * Create a mock ZodObject schema with a shape
 */
function mockObjectSchema(shape: Record<string, IZodSchema>): IZodSchema {
  return mockZodSchema({
    typeName: 'ZodObject',
    shape: () => shape,
  });
}

describe('zodToJsonSchema', () => {
  it('should convert a simple object schema with string fields', () => {
    const schema = mockObjectSchema({
      name: mockZodSchema({ typeName: 'ZodString' }),
    });

    const result = zodToJsonSchema(schema);

    expect(result.type).toBe('object');
    expect(result.properties).toHaveProperty('name');
    expect(result.properties.name.type).toBe('string');
    expect(result.required).toContain('name');
  });

  it('should convert number fields', () => {
    const schema = mockObjectSchema({
      count: mockZodSchema({ typeName: 'ZodNumber' }),
    });

    const result = zodToJsonSchema(schema);

    expect(result.properties.count.type).toBe('number');
    expect(result.required).toContain('count');
  });

  it('should convert boolean fields', () => {
    const schema = mockObjectSchema({
      enabled: mockZodSchema({ typeName: 'ZodBoolean' }),
    });

    const result = zodToJsonSchema(schema);

    expect(result.properties.enabled.type).toBe('boolean');
  });

  it('should convert array fields with item types', () => {
    const schema = mockObjectSchema({
      tags: mockZodSchema({
        typeName: 'ZodArray',
        type: mockZodSchema({ typeName: 'ZodString' }),
      }),
    });

    const result = zodToJsonSchema(schema);

    expect(result.properties.tags.type).toBe('array');
    expect(result.properties.tags.items).toBeDefined();
    expect(result.properties.tags.items?.type).toBe('string');
  });

  it('should throw for ZodArray missing item type', () => {
    const schema = mockObjectSchema({
      tags: mockZodSchema({ typeName: 'ZodArray' }),
    });

    expect(() => zodToJsonSchema(schema)).toThrow('missing item type');
  });

  it('should convert object fields', () => {
    const schema = mockObjectSchema({
      config: mockZodSchema({ typeName: 'ZodObject' }),
    });

    const result = zodToJsonSchema(schema);

    expect(result.properties.config.type).toBe('object');
  });

  it('should convert enum fields', () => {
    const schema = mockObjectSchema({
      color: mockZodSchema({
        typeName: 'ZodEnum',
        values: ['red', 'green', 'blue'],
      }),
    });

    const result = zodToJsonSchema(schema);

    expect(result.properties.color.type).toBe('string');
    expect(result.properties.color.enum).toEqual(['red', 'green', 'blue']);
  });

  it('should throw for ZodEnum missing values', () => {
    const schema = mockObjectSchema({
      color: mockZodSchema({ typeName: 'ZodEnum' }),
    });

    expect(() => zodToJsonSchema(schema)).toThrow('missing enum values');
  });

  it('should mark optional fields as not required', () => {
    const schema = mockObjectSchema({
      name: mockZodSchema({ typeName: 'ZodString' }),
      nickname: mockZodSchema({
        typeName: 'ZodOptional',
        innerType: mockZodSchema({ typeName: 'ZodString' }),
      }),
    });

    const result = zodToJsonSchema(schema);

    expect(result.required).toContain('name');
    expect(result.required).not.toContain('nickname');
    expect(result.properties.nickname.type).toBe('string');
  });

  it('should handle nullable fields as not required', () => {
    const schema = mockObjectSchema({
      value: mockZodSchema({
        typeName: 'ZodNullable',
        innerType: mockZodSchema({ typeName: 'ZodNumber' }),
      }),
    });

    const result = zodToJsonSchema(schema);

    expect(result.required).not.toContain('value');
    expect(result.properties.value.type).toBe('number');
  });

  it('should handle default fields as not required', () => {
    const schema = mockObjectSchema({
      limit: mockZodSchema({
        typeName: 'ZodDefault',
        innerType: mockZodSchema({ typeName: 'ZodNumber' }),
      }),
    });

    const result = zodToJsonSchema(schema);

    expect(result.required).not.toContain('limit');
    expect(result.properties.limit.type).toBe('number');
  });

  it('should include description from type definition', () => {
    const schema = mockObjectSchema({
      name: mockZodSchema({
        typeName: 'ZodString',
        description: 'The user name',
      }),
    });

    const result = zodToJsonSchema(schema);

    expect(result.properties.name.description).toBe('The user name');
  });

  it('should throw for unsupported Zod types', () => {
    const schema = mockObjectSchema({
      field: mockZodSchema({ typeName: 'ZodTuple' }),
    });

    expect(() => zodToJsonSchema(schema)).toThrow('Unsupported Zod type');
  });

  it('should throw when schema is missing _def', () => {
    const schema: IZodSchema = {
      parse: (v) => v,
      safeParse: (v) => ({ success: true, data: v }),
      _def: undefined,
    };

    expect(() => zodToJsonSchema(schema)).toThrow('missing _def');
  });

  it('should throw for ZodOptional missing innerType', () => {
    const schema = mockObjectSchema({
      field: mockZodSchema({ typeName: 'ZodOptional' }),
    });

    expect(() => zodToJsonSchema(schema)).toThrow('missing innerType');
  });

  it('should throw for ZodNullable missing innerType', () => {
    const schema = mockObjectSchema({
      field: mockZodSchema({ typeName: 'ZodNullable' }),
    });

    expect(() => zodToJsonSchema(schema)).toThrow('missing innerType');
  });

  it('should throw for ZodDefault missing innerType', () => {
    const schema = mockObjectSchema({
      field: mockZodSchema({ typeName: 'ZodDefault' }),
    });

    expect(() => zodToJsonSchema(schema)).toThrow('missing innerType');
  });

  it('should produce empty properties for schema with no shape fields', () => {
    const schema = mockObjectSchema({});

    const result = zodToJsonSchema(schema);

    expect(result.type).toBe('object');
    expect(Object.keys(result.properties)).toHaveLength(0);
    expect(result.required).toEqual([]);
  });

  it('should handle mixed required and optional fields', () => {
    const schema = mockObjectSchema({
      required1: mockZodSchema({ typeName: 'ZodString' }),
      optional1: mockZodSchema({
        typeName: 'ZodOptional',
        innerType: mockZodSchema({ typeName: 'ZodString' }),
      }),
      required2: mockZodSchema({ typeName: 'ZodNumber' }),
    });

    const result = zodToJsonSchema(schema);

    expect(result.required).toContain('required1');
    expect(result.required).toContain('required2');
    expect(result.required).not.toContain('optional1');
  });
});

describe('extractEnumValues', () => {
  it('should extract enum values from a ZodEnum schema', () => {
    const schema = mockZodSchema({
      typeName: 'ZodEnum',
      values: ['a', 'b', 'c'],
    });

    expect(extractEnumValues(schema)).toEqual(['a', 'b', 'c']);
  });

  it('should throw when schema is missing _def', () => {
    const schema: IZodSchema = {
      parse: (v) => v,
      safeParse: (v) => ({ success: true, data: v }),
      _def: undefined,
    };

    expect(() => extractEnumValues(schema)).toThrow('missing _def');
  });

  it('should throw when values are missing', () => {
    const schema = mockZodSchema({ typeName: 'ZodEnum' });

    expect(() => extractEnumValues(schema)).toThrow('missing enum values');
  });
});

describe('hasValidationConstraints', () => {
  it('should return true when checks are present', () => {
    const schema = mockZodSchema({
      typeName: 'ZodString',
      checks: [{ kind: 'min', value: 1 }],
    });

    expect(hasValidationConstraints(schema)).toBe(true);
  });

  it('should return false when no checks are present', () => {
    const schema = mockZodSchema({ typeName: 'ZodString' });

    expect(hasValidationConstraints(schema)).toBe(false);
  });

  it('should return false when checks array is empty', () => {
    const schema = mockZodSchema({ typeName: 'ZodString', checks: [] });

    expect(hasValidationConstraints(schema)).toBe(false);
  });

  it('should throw when _def is missing', () => {
    const schema: IZodSchema = {
      parse: (v) => v,
      safeParse: (v) => ({ success: true, data: v }),
      _def: undefined,
    };

    expect(() => hasValidationConstraints(schema)).toThrow('missing _def');
  });
});

describe('getSchemaTypeName', () => {
  it('should return the typeName from the schema definition', () => {
    const schema = mockZodSchema({ typeName: 'ZodString' });

    expect(getSchemaTypeName(schema)).toBe('ZodString');
  });

  it('should throw when _def is missing', () => {
    const schema: IZodSchema = {
      parse: (v) => v,
      safeParse: (v) => ({ success: true, data: v }),
      _def: undefined,
    };

    expect(() => getSchemaTypeName(schema)).toThrow('missing _def');
  });

  it('should throw when typeName is empty', () => {
    const schema = mockZodSchema({ typeName: '' });

    expect(() => getSchemaTypeName(schema)).toThrow('empty typeName');
  });
});
