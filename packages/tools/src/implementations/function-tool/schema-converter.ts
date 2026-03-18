/**
 * FunctionTool - Schema conversion utilities for Facade pattern
 *
 * REASON: Complex Zod to JSON schema conversion requires isolated utility functions
 * ALTERNATIVES_CONSIDERED:
 * 1. Keep conversion logic in main class (violates single responsibility)
 * 2. Use third-party library (adds external dependency)
 * 3. Manual conversion each time (code duplication)
 * 4. Runtime type checking only (loses compile-time safety)
 * 5. Remove Zod support (breaks backward compatibility)
 * TODO: Consider caching conversion results for performance
 */

import type {
  IToolSchema,
  IParameterSchema,
  TJSONSchemaEnum,
  TUniversalValue,
} from '@robota-sdk/agents';
import type { IZodSchema, ISchemaConversionOptions } from './types';

/**
 * Convert Zod schema to JSON Schema format with safe undefined handling
 */
export function zodToJsonSchema(
  schema: IZodSchema,
  options: ISchemaConversionOptions = {},
): IToolSchema['parameters'] {
  const properties: Record<string, IParameterSchema> = {};
  const required: string[] = [];

  // Safe access to schema definition (no fallback).
  const schemaDef = schema._def;
  if (!schemaDef) {
    throw new Error('Zod schema is missing _def; cannot convert to JSON schema.');
  }

  // Handle object schemas with shape
  if (schemaDef.typeName === 'ZodObject' && schemaDef.shape) {
    // In Zod v3, shape is a property, not a function
    const shape = typeof schemaDef.shape === 'function' ? schemaDef.shape() : schemaDef.shape;

    for (const [key, typeObj] of Object.entries(shape)) {
      const property = convertZodTypeToProperty(typeObj);
      properties[key] = property;

      // Check if field is required (not optional/nullable)
      if (isRequiredField(typeObj)) {
        required.push(key);
      }
    }
  }

  return {
    type: 'object',
    properties,
    required,
    ...(options.allowAdditionalProperties && { additionalProperties: true }),
  };
}

/**
 * Convert individual Zod type to parameter schema with safe undefined handling
 */
function convertZodTypeToProperty(typeObj: IZodSchema): IParameterSchema {
  // Safe access to type definition
  const typeDef = typeObj._def;
  if (!typeDef) {
    throw new Error('Zod type is missing _def; cannot convert to JSON schema.');
  }

  const base: Partial<IParameterSchema> = {};

  // Add description if available
  if (typeDef.description) {
    base.description = typeDef.description;
  }

  // Handle different Zod types
  switch (typeDef.typeName) {
    case 'ZodString':
      return { type: 'string', ...base };

    case 'ZodNumber':
      return { type: 'number', ...base };

    case 'ZodBoolean':
      return { type: 'boolean', ...base };

    case 'ZodArray': {
      if (!typeDef.type) {
        throw new Error('ZodArray is missing item type; cannot convert to JSON schema.');
      }
      const arrayItems = convertZodTypeToProperty(typeDef.type);
      return {
        type: 'array',
        items: arrayItems,
        ...base,
      };
    }

    case 'ZodObject':
      return { type: 'object', ...base };

    case 'ZodEnum': {
      const enumValues = typeDef.values;
      if (!enumValues || !Array.isArray(enumValues)) {
        throw new Error('ZodEnum is missing enum values; cannot convert to JSON schema.');
      }
      return {
        type: 'string',
        enum: enumValues as TJSONSchemaEnum,
        ...base,
      };
    }

    case 'ZodOptional':
      // Handle optional types by recursion
      if (typeDef.innerType) {
        const innerProperty = convertZodTypeToProperty(typeDef.innerType);
        return { ...innerProperty, ...base };
      }
      throw new Error('ZodOptional is missing innerType; cannot convert to JSON schema.');

    case 'ZodNullable':
      // Handle nullable types
      if (typeDef.innerType) {
        const innerProperty = convertZodTypeToProperty(typeDef.innerType);
        return { ...innerProperty, ...base };
      }
      throw new Error('ZodNullable is missing innerType; cannot convert to JSON schema.');

    case 'ZodDefault':
      // Handle default values by processing the inner type
      if (typeDef.innerType) {
        const innerProperty = convertZodTypeToProperty(typeDef.innerType);
        return { ...innerProperty, ...base };
      }
      throw new Error('ZodDefault is missing innerType; cannot convert to JSON schema.');

    default:
      throw new Error(`Unsupported Zod type: ${String(typeDef.typeName)}`);
  }
}

/**
 * Check if a Zod field is required (not optional or nullable)
 */
function isRequiredField(typeObj: IZodSchema): boolean {
  const typeDef = typeObj._def;
  if (!typeDef) {
    throw new Error('Zod schema is missing _def; cannot determine required fields.');
  }

  // Field is optional if it's ZodOptional, ZodNullable, or ZodDefault
  return (
    typeDef.typeName !== 'ZodOptional' &&
    typeDef.typeName !== 'ZodNullable' &&
    typeDef.typeName !== 'ZodDefault'
  );
}

/**
 * Safely extract enum values from Zod schema
 */
export function extractEnumValues(schema: IZodSchema): TUniversalValue[] {
  const typeDef = schema._def;
  if (!typeDef) {
    throw new Error('Zod schema is missing _def; cannot extract enum values.');
  }
  if (!typeDef.values || !Array.isArray(typeDef.values)) {
    throw new Error('ZodEnum schema is missing enum values; cannot extract enum values.');
  }
  return typeDef.values;
}

/**
 * Check if schema has validation constraints
 */
export function hasValidationConstraints(schema: IZodSchema): boolean {
  const typeDef = schema._def;
  if (!typeDef) {
    throw new Error('Zod schema is missing _def; cannot determine validation constraints.');
  }

  return !!(typeDef.checks && typeDef.checks.length > 0);
}

/**
 * Safe schema type name extraction
 */
export function getSchemaTypeName(schema: IZodSchema): string {
  const typeDef = schema._def;
  if (!typeDef) {
    throw new Error('Zod schema is missing _def; cannot determine schema type name.');
  }
  if (!typeDef.typeName) {
    throw new Error('Zod schema has empty typeName; cannot determine schema type name.');
  }
  return typeDef.typeName;
}
