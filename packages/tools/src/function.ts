/**
 * Function creation and invocation utilities
 * 
 * @module Function
 * @description
 * Main module for creating and managing functions that AI can invoke.
 * Re-exports functionality from specialized modules.
 * 
 * @see {@link ./factories/function-factory} - Function creation utilities
 * @see {@link ./registry/function-registry} - Function registry management
 * @see {@link ./schema/zod-to-json} - Zod to JSON schema conversion
 * @see {@link ./schema/json-to-zod} - JSON to Zod schema conversion
 */

// Re-export main function creation utilities
export {
    createFunction,
    functionFromCallback,
    createValidatedFunction,
    type FunctionResult,
    type FunctionOptions,
    type ToolFunction
} from './factories/function-factory';

// Re-export registry functionality
export {
    FunctionRegistry,
    type FunctionHandler
} from './registry/function-registry';

// Re-export schema conversion utilities
export {
    zodToJsonSchema,
    convertZodTypeToJsonSchema,
    getZodDescription,
    isOptionalType,
    isNullableType
} from './schema/zod-to-json';

export {
    createFunctionSchema
} from './schema/json-to-zod';

// Keep backward compatibility by re-exporting under original names
export { createFunctionSchema as createFunctionSchemaLegacy } from './schema/json-to-zod'; 