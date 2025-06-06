/**
 * JSON Schema to Zod conversion utilities
 * 
 * @module JsonToZod
 * @description
 * Pure functions for converting JSON Schema to Zod schema format.
 * These functions are side-effect free and can be easily tested.
 */

import { z } from 'zod';
import type { FunctionDefinition } from '../types';

/**
 * Create Zod schema from function definition
 * 
 * @param definition - Function definition with JSON schema parameters
 * @returns Zod schema for validation
 */
export function createFunctionSchema(definition: FunctionDefinition): z.ZodObject<any> {
    const propertySchemas: Record<string, z.ZodTypeAny> = {};

    if (definition.parameters && definition.parameters.properties) {
        for (const [key, prop] of Object.entries(definition.parameters.properties)) {
            propertySchemas[key] = convertJsonSchemaToZod(prop, key);
        }
    }

    return z.object(propertySchemas);
}

/**
 * Convert JSON schema property to Zod type
 * 
 * @param property - JSON schema property
 * @param fieldName - Field name for error messages
 * @returns Corresponding Zod type
 */
function convertJsonSchemaToZod(property: any, fieldName: string): z.ZodTypeAny {
    if (!property.type) {
        console.warn(`No type specified for field ${fieldName}, using z.any()`);
        return z.any();
    }

    switch (property.type) {
        case 'string':
            return createZodString(property);
        case 'number':
            return createZodNumber(property);
        case 'integer':
            return createZodInteger(property);
        case 'boolean':
            return z.boolean();
        case 'array':
            return createZodArray(property, fieldName);
        case 'object':
            return createZodObject(property);
        default:
            console.warn(`Unsupported type ${property.type} for field ${fieldName}, using z.any()`);
            return z.any();
    }
}

/**
 * Create Zod string schema with constraints
 */
function createZodString(property: any): z.ZodString {
    let schema = z.string();

    if (property.minLength !== undefined) {
        schema = schema.min(property.minLength);
    }
    if (property.maxLength !== undefined) {
        schema = schema.max(property.maxLength);
    }
    if (property.pattern) {
        schema = schema.regex(new RegExp(property.pattern));
    }
    if (property.format === 'email') {
        schema = schema.email();
    }
    if (property.format === 'uri' || property.format === 'url') {
        schema = schema.url();
    }

    return schema;
}

/**
 * Create Zod number schema with constraints
 */
function createZodNumber(property: any): z.ZodNumber {
    let schema = z.number();

    if (property.minimum !== undefined) {
        schema = schema.min(property.minimum);
    }
    if (property.maximum !== undefined) {
        schema = schema.max(property.maximum);
    }

    return schema;
}

/**
 * Create Zod integer schema with constraints
 */
function createZodInteger(property: any): z.ZodNumber {
    let schema = z.number().int();

    if (property.minimum !== undefined) {
        schema = schema.min(property.minimum);
    }
    if (property.maximum !== undefined) {
        schema = schema.max(property.maximum);
    }

    return schema;
}

/**
 * Create Zod array schema
 */
function createZodArray(property: any, fieldName: string): z.ZodArray<any> {
    const itemSchema = property.items
        ? convertJsonSchemaToZod(property.items, `${fieldName}[]`)
        : z.any();

    let schema = z.array(itemSchema);

    if (property.minItems !== undefined) {
        schema = schema.min(property.minItems);
    }
    if (property.maxItems !== undefined) {
        schema = schema.max(property.maxItems);
    }

    return schema;
}

/**
 * Create Zod object schema
 */
function createZodObject(_property: any): z.ZodRecord<any> {
    // For now, use z.record for generic objects
    // Could be enhanced to create proper object schemas
    return z.record(z.any());
} 