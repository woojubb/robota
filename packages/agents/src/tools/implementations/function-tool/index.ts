/**
 * FunctionTool - Centralized exports for Facade pattern
 * 
 * This module provides a clean interface for function tool functionality
 * with proper separation of concerns and type safety.
 */

// Core types
export type {
    ZodSchema,
    ZodParseResult,
    ZodSchemaDef,
    ToolExecutor,
    IFunctionTool,
    ValidationOptions,
    SchemaConversionOptions,
    ToolExecutionMetadata,
    ToolResult,
    ToolParameterValue
} from './types';

// Schema conversion utilities
export {
    zodToJsonSchema,
    extractEnumValues,
    hasValidationConstraints,
    getSchemaTypeName
} from './schema-converter';

// Main function tool class (to be imported from refactored implementation)
// export { FunctionTool } from './function-tool';

// Helper functions for creating tools
// export { createFunctionTool, createZodFunctionTool } from './factory'; 