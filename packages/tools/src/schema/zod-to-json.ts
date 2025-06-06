/**
 * Zod to JSON Schema conversion utilities
 * 
 * @module ZodToJson
 * @description
 * Pure functions for converting Zod schemas to JSON Schema format.
 * These functions are side-effect free and can be easily tested.
 */

import { z } from 'zod';

/**
 * Convert zod schema to JSON schema format
 * 
 * @param schema - Zod object schema
 * @returns JSON schema representation
 */
export function zodToJsonSchema(schema: z.ZodObject<any>): any {
    const jsonSchema: any = {
        type: 'object',
        properties: {},
        required: []
    };

    // Convert zod schema's shape object to JSON schema properties
    const shape = schema._def.shape();
    const entries = Object.entries(shape);

    for (const [key, value] of entries) {
        const fieldSchema = convertZodTypeToJsonSchema(value as z.ZodTypeAny, key);
        jsonSchema.properties[key] = fieldSchema;

        // Check required fields (when not optional and not nullable)
        if (!isOptionalType(value as z.ZodTypeAny) && !isNullableType(value as z.ZodTypeAny)) {
            if (!jsonSchema.required) {
                jsonSchema.required = [];
            }
            jsonSchema.required.push(key);
        }
    }

    return jsonSchema;
}

/**
 * Convert zod type to JSON schema type
 * 
 * @param zodType - Zod type to convert
 * @param fieldName - Field name for error messages
 * @returns JSON schema type representation
 */
export function convertZodTypeToJsonSchema(zodType: z.ZodTypeAny, fieldName: string): any {
    // Basic JSON schema object
    const jsonSchema: any = {};

    // Extract description
    const description = getZodDescription(zodType);
    if (description) {
        jsonSchema.description = description;
    }

    // Convert by type
    if (zodType instanceof z.ZodString) {
        return convertZodString(zodType, jsonSchema);
    } else if (zodType instanceof z.ZodNumber) {
        return convertZodNumber(zodType, jsonSchema);
    } else if (zodType instanceof z.ZodBoolean) {
        jsonSchema.type = 'boolean';
    } else if (zodType instanceof z.ZodArray) {
        return convertZodArray(zodType, jsonSchema, fieldName);
    } else if (zodType instanceof z.ZodEnum) {
        return convertZodEnum(zodType, jsonSchema);
    } else if (zodType instanceof z.ZodObject) {
        return convertZodObject(zodType, jsonSchema);
    } else if (zodType instanceof z.ZodUnion) {
        return convertZodUnion(zodType, jsonSchema, fieldName);
    } else if (zodType instanceof z.ZodOptional) {
        return convertZodTypeToJsonSchema(zodType._def.innerType, fieldName);
    } else if (zodType instanceof z.ZodNullable) {
        return convertZodNullable(zodType, jsonSchema, fieldName);
    } else if (zodType instanceof z.ZodDefault) {
        return convertZodDefault(zodType, jsonSchema, fieldName);
    } else {
        // Other types are handled as strings
        jsonSchema.type = 'string';
        console.warn(`Unsupported zod type for field ${fieldName}, using string as fallback`);
    }

    return jsonSchema;
}

/**
 * Convert ZodString to JSON schema
 */
function convertZodString(zodType: z.ZodString, jsonSchema: any): any {
    jsonSchema.type = 'string';

    // String constraints
    if (zodType._def.checks) {
        for (const check of zodType._def.checks) {
            switch (check.kind) {
                case 'min':
                    jsonSchema.minLength = check.value;
                    break;
                case 'max':
                    jsonSchema.maxLength = check.value;
                    break;
                case 'regex':
                    jsonSchema.pattern = check.regex.source;
                    break;
                case 'email':
                    jsonSchema.format = 'email';
                    break;
                case 'url':
                    jsonSchema.format = 'uri';
                    break;
            }
        }
    }

    return jsonSchema;
}

/**
 * Convert ZodNumber to JSON schema
 */
function convertZodNumber(zodType: z.ZodNumber, jsonSchema: any): any {
    jsonSchema.type = 'number';

    // Number constraints
    if (zodType._def.checks) {
        for (const check of zodType._def.checks) {
            switch (check.kind) {
                case 'min':
                    jsonSchema.minimum = check.value;
                    break;
                case 'max':
                    jsonSchema.maximum = check.value;
                    break;
                case 'int':
                    jsonSchema.type = 'integer';
                    break;
            }
        }
    }

    return jsonSchema;
}

/**
 * Convert ZodArray to JSON schema
 */
function convertZodArray(zodType: z.ZodArray<any>, jsonSchema: any, fieldName: string): any {
    jsonSchema.type = 'array';
    jsonSchema.items = convertZodTypeToJsonSchema(zodType._def.type, `${fieldName}[]`);

    // Array constraints
    if (zodType._def.minLength !== null) {
        jsonSchema.minItems = zodType._def.minLength.value;
    }
    if (zodType._def.maxLength !== null) {
        jsonSchema.maxItems = zodType._def.maxLength.value;
    }

    return jsonSchema;
}

/**
 * Convert ZodEnum to JSON schema
 */
function convertZodEnum(zodType: z.ZodEnum<any>, jsonSchema: any): any {
    jsonSchema.type = 'string';
    jsonSchema.enum = zodType._def.values;
    return jsonSchema;
}

/**
 * Convert ZodObject to JSON schema
 */
function convertZodObject(zodType: z.ZodObject<any>, jsonSchema: any): any {
    jsonSchema.type = 'object';
    const nestedSchema = zodToJsonSchema(zodType);
    jsonSchema.properties = nestedSchema.properties;
    jsonSchema.required = nestedSchema.required;
    return jsonSchema;
}

/**
 * Convert ZodUnion to JSON schema
 */
function convertZodUnion(zodType: z.ZodUnion<any>, jsonSchema: any, fieldName: string): any {
    jsonSchema.oneOf = zodType._def.options.map((option: z.ZodTypeAny) =>
        convertZodTypeToJsonSchema(option, fieldName)
    );
    return jsonSchema;
}

/**
 * Convert ZodNullable to JSON schema
 */
function convertZodNullable(zodType: z.ZodNullable<any>, jsonSchema: any, fieldName: string): any {
    const innerSchema = convertZodTypeToJsonSchema(zodType._def.innerType, fieldName);
    jsonSchema.type = [innerSchema.type, 'null'];
    Object.assign(jsonSchema, innerSchema);
    return jsonSchema;
}

/**
 * Convert ZodDefault to JSON schema
 */
function convertZodDefault(zodType: z.ZodDefault<any>, jsonSchema: any, fieldName: string): any {
    const innerSchema = convertZodTypeToJsonSchema(zodType._def.innerType, fieldName);
    Object.assign(jsonSchema, innerSchema);
    jsonSchema.default = zodType._def.defaultValue();
    return jsonSchema;
}

/**
 * Extract description from zod type
 * 
 * @param zodType - Zod type to extract description from
 * @returns Description string if available
 */
export function getZodDescription(zodType: z.ZodTypeAny): string | undefined {
    // Extract description from zod type metadata
    const description = zodType._def.description;
    if (description) return description;

    // Recursively extract description if there's an inner type
    if (zodType instanceof z.ZodOptional || zodType instanceof z.ZodNullable) {
        return getZodDescription(zodType._def.innerType);
    }

    return undefined;
}

/**
 * Check if zod type is optional
 * 
 * @param zodType - Zod type to check
 * @returns True if the type is optional
 */
export function isOptionalType(zodType: z.ZodTypeAny): boolean {
    return zodType instanceof z.ZodOptional ||
        (zodType instanceof z.ZodDefault);
}

/**
 * Check if zod type allows null
 * 
 * @param zodType - Zod type to check
 * @returns True if the type is nullable
 */
export function isNullableType(zodType: z.ZodTypeAny): boolean {
    return zodType instanceof z.ZodNullable;
} 