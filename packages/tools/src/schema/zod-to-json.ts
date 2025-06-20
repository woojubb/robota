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
    // Handle wrapper types first (Optional, Nullable, Default)
    const { innerType, wrapperMetadata } = unwrapZodType(zodType);

    // Convert the core type
    const jsonSchema = convertCoreZodType(innerType, fieldName);

    // Apply wrapper metadata (description, default, nullable)
    return applyWrapperMetadata(jsonSchema, wrapperMetadata);
}

/**
 * Unwrap zod wrapper types and collect metadata
 */
function unwrapZodType(zodType: z.ZodTypeAny): {
    innerType: z.ZodTypeAny;
    wrapperMetadata: {
        description?: string;
        defaultValue?: any;
        nullable?: boolean;
        optional?: boolean;
    };
} {
    let currentType = zodType;
    const metadata: any = {
        optional: false,
        nullable: false
    };

    // Unwrap all wrapper types and collect metadata
    while (true) {
        // Check for description first (before unwrapping)
        if (currentType._def.description && !metadata.description) {
            metadata.description = currentType._def.description;
        }

        if (currentType instanceof z.ZodOptional) {
            metadata.optional = true;
            currentType = currentType._def.innerType;
        } else if (currentType instanceof z.ZodNullable) {
            metadata.nullable = true;
            currentType = currentType._def.innerType;
        } else if (currentType instanceof z.ZodDefault) {
            metadata.optional = true;
            metadata.defaultValue = currentType._def.defaultValue();
            currentType = currentType._def.innerType;
        } else {
            break;
        }
    }

    return {
        innerType: currentType,
        wrapperMetadata: metadata
    };
}

/**
 * Convert core zod types (without wrappers)
 */
function convertCoreZodType(zodType: z.ZodTypeAny, fieldName: string): any {
    const jsonSchema: any = {};

    if (zodType instanceof z.ZodString) {
        return convertZodString(zodType, jsonSchema);
    } else if (zodType instanceof z.ZodNumber) {
        return convertZodNumber(zodType, jsonSchema);
    } else if (zodType instanceof z.ZodBoolean) {
        jsonSchema.type = 'boolean';
        return jsonSchema;
    } else if (zodType instanceof z.ZodArray) {
        return convertZodArray(zodType, jsonSchema, fieldName);
    } else if (zodType instanceof z.ZodEnum) {
        return convertZodEnum(zodType, jsonSchema);
    } else if (zodType instanceof z.ZodObject) {
        return convertZodObject(zodType, jsonSchema);
    } else if (zodType instanceof z.ZodUnion) {
        return convertZodUnion(zodType, jsonSchema, fieldName);
    } else {
        // Fallback for unsupported types
        jsonSchema.type = 'string';
        console.warn(`Unsupported zod type for field ${fieldName}, using string as fallback`);
        return jsonSchema;
    }
}

/**
 * Apply wrapper metadata to JSON schema
 */
function applyWrapperMetadata(jsonSchema: any, metadata: any): any {
    // Apply description (highest priority from outermost wrapper)
    if (metadata.description) {
        jsonSchema.description = metadata.description;
    }

    // Apply default value
    if (metadata.defaultValue !== undefined) {
        jsonSchema.default = metadata.defaultValue;
    }

    // Apply nullable (modify type to allow null)
    if (metadata.nullable) {
        if (Array.isArray(jsonSchema.type)) {
            jsonSchema.type = [...jsonSchema.type, 'null'];
        } else {
            jsonSchema.type = [jsonSchema.type, 'null'];
        }
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