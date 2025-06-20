/**
 * Function tool schema and type definitions module
 * 
 * Provides utility functions for converting Zod schemas to JSON schemas.
 * Supports type definitions and conversion functionality for Robota's function tool definitions.
 * 
 * @module zod-schema
 * @description
 * Provides utility functions for converting Zod schemas to JSON schemas.
 * Supports type definitions and conversion functionality for Robota's function tool definitions.
 */

import { z } from 'zod';
import type { FunctionSchema } from './index.js';

/**
 * Converts Zod object schema to JSON schema.
 * 
 * @param schema - Zod object schema to convert
 * @returns JSON schema object
 * 
 * @see {@link ../../apps/examples/02-functions | Function Tool Examples}
 */
export function zodToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
} {
    // Extract properties from z.object
    const shape = schema._def.shape();

    // Configure JSON schema properties
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    // Process each property
    Object.entries(shape).forEach(([key, zodType]) => {
        // zodType is a z.ZodType instance
        let typeObj = zodType as z.ZodTypeAny;
        let isOptional = false;
        let description: string | undefined;

        // Handle optional types and preserve description
        if (typeObj instanceof z.ZodOptional) {
            isOptional = true;
            // Get description from optional wrapper first
            description = typeObj._def.description;
            typeObj = typeObj._def.innerType;
        }

        // Basic property information
        let property: Record<string, unknown> = {};

        // Type processing
        if (typeObj instanceof z.ZodNumber) {
            property.type = "number";
        } else if (typeObj instanceof z.ZodString) {
            property.type = "string";
        } else if (typeObj instanceof z.ZodBoolean) {
            property.type = "boolean";
        } else if (typeObj instanceof z.ZodEnum) {
            property.type = "string";
            property.enum = typeObj._def.values;
        } else if (typeObj instanceof z.ZodArray) {
            property.type = "array";
            // Process array item type
            if (typeObj._def.type instanceof z.ZodString) {
                property.items = { type: "string" };
            } else if (typeObj._def.type instanceof z.ZodObject) {
                property.items = zodToJsonSchema(typeObj._def.type as z.ZodObject<z.ZodRawShape>);
            }
        } else if (typeObj instanceof z.ZodObject) {
            // Process nested object
            property = zodToJsonSchema(typeObj);
        } else {
            // Fallback for unsupported types
            property.type = "string";
        }

        // Add description - try optional wrapper first, then inner type
        if (!description) {
            description = typeObj._def.description;
        }
        if (description) {
            property.description = description;
        }

        // Add to required if not optional
        if (!isOptional) {
            required.push(key);
        }

        properties[key] = property;
    });

    // Final JSON schema object
    return {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined
    };
}

/**
 * Zod schema-based function tool definition interface
 */
export interface ZodFunctionTool<T extends z.ZodTypeAny = z.ZodTypeAny> {
    /** Tool name */
    name: string;
    /** Tool description */
    description: string;
    /** Tool parameter schema */
    parameters: T;
    /** Tool handler function */
    handler: (params: z.infer<T>) => Promise<unknown>;
}

/**
 * Converts a Zod function tool to a Robota-compatible function schema.
 * 
 * @param tool - Zod-based function tool definition
 * @returns Robota-compatible function schema
 */
export function zodFunctionToSchema<T extends z.ZodObject<z.ZodRawShape>>(tool: ZodFunctionTool<T>) {
    return {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters)
    };
} 