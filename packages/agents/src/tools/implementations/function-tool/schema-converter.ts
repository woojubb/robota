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

import type { ToolSchema, ParameterSchema, JSONSchemaEnum } from '../../../interfaces/provider';
import type {
    ZodSchema,
    ToolParameterValue,
    SchemaConversionOptions
} from './types';

/**
 * Convert Zod schema to JSON Schema format with safe undefined handling
 */
export function zodToJsonSchema(
    schema: ZodSchema,
    options: SchemaConversionOptions = {}
): ToolSchema['parameters'] {
    const properties: Record<string, ParameterSchema> = {};
    const required: string[] = [];

    // Safe access to schema definition with fallback
    const schemaDef = schema._def;
    if (!schemaDef) {
        return {
            type: 'object',
            properties: {},
            required: []
        };
    }

    // Handle object schemas with shape
    if (schemaDef.typeName === 'ZodObject' && schemaDef.shape) {
        const shape = schemaDef.shape();

        for (const [key, typeObj] of Object.entries(shape)) {
            // Safe property conversion with undefined checks
            const property = convertZodTypeToProperty(typeObj);
            if (property) {
                properties[key] = property;

                // Check if field is required (not optional/nullable)
                if (isRequiredField(typeObj)) {
                    required.push(key);
                }
            }
        }
    }

    return {
        type: 'object',
        properties,
        required,
        ...(options.allowAdditionalProperties && { additionalProperties: true })
    };
}

/**
 * Convert individual Zod type to parameter schema with safe undefined handling
 */
function convertZodTypeToProperty(typeObj: ZodSchema): ParameterSchema | null {
    // Safe access to type definition
    const typeDef = typeObj._def;
    if (!typeDef) {
        return null;
    }

    const base: Partial<ParameterSchema> = {};

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
            // Safe handling of array item types
            const arrayItems = typeDef.type ? convertZodTypeToProperty(typeDef.type) : null;
            return {
                type: 'array',
                items: arrayItems || { type: 'string' }, // Fallback to string type
                ...base
            };
        }

        case 'ZodObject':
            return { type: 'object', ...base };

        case 'ZodEnum': {
            // Safe enum value extraction with undefined check
            const enumValues = typeDef.values;
            if (enumValues && Array.isArray(enumValues)) {
                return {
                    type: 'string',
                    enum: enumValues as JSONSchemaEnum,
                    ...base
                };
            }
            return { type: 'string', ...base };
        }

        case 'ZodOptional':
            // Handle optional types by recursion
            if (typeDef.innerType) {
                const innerProperty = convertZodTypeToProperty(typeDef.innerType);
                return innerProperty ? { ...innerProperty, ...base } : null;
            }
            return null;

        case 'ZodNullable':
            // Handle nullable types
            if (typeDef.innerType) {
                const innerProperty = convertZodTypeToProperty(typeDef.innerType);
                return innerProperty ? { ...innerProperty, ...base } : null;
            }
            return null;

        default:
            // Fallback for unknown types
            return { type: 'string', ...base };
    }
}

/**
 * Check if a Zod field is required (not optional or nullable)
 */
function isRequiredField(typeObj: ZodSchema): boolean {
    const typeDef = typeObj._def;
    if (!typeDef) {
        return false;
    }

    // Field is optional if it's ZodOptional or ZodNullable
    return typeDef.typeName !== 'ZodOptional' &&
        typeDef.typeName !== 'ZodNullable';
}

/**
 * Safely extract enum values from Zod schema
 */
export function extractEnumValues(schema: ZodSchema): ToolParameterValue[] {
    const typeDef = schema._def;
    if (!typeDef || !typeDef.values || !Array.isArray(typeDef.values)) {
        return [];
    }

    return typeDef.values;
}

/**
 * Check if schema has validation constraints
 */
export function hasValidationConstraints(schema: ZodSchema): boolean {
    const typeDef = schema._def;
    if (!typeDef) {
        return false;
    }

    return !!(typeDef.checks && typeDef.checks.length > 0);
}

/**
 * Safe schema type name extraction
 */
export function getSchemaTypeName(schema: ZodSchema): string {
    const typeDef = schema._def;
    return typeDef?.typeName || 'Unknown';
} 