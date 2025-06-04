/**
 * Tool module
 * 
 * @module Tool
 * @description
 * Modern tool system with inheritance-based architecture.
 * Provides base class functionality and schema-specific implementations.
 * 
 * @see {@link ../../../apps/examples/02-functions | Function Tool Examples}
 */

// Modern tool implementations
export { BaseTool } from './base-tool';
export { ZodTool } from './zod-tool';
export { McpTool } from './mcp-tool';
export { OpenApiTool } from './openapi-tool';
export { ToolRegistry } from './tool-registry';

// Interfaces and types
export type {
    ToolInterface,
    ToolResult,
    BaseToolOptions,
    ZodToolOptions,
    McpToolOptions,
    OpenApiToolOptions
} from './interfaces';

// Legacy implementations have been removed
// Use ZodTool, McpTool, or OpenApiTool instead 