/**
 * Tool module
 * 
 * @module Tool
 * @description
 * Modern tool system with inheritance-based architecture.
 * Provides base class functionality and schema-specific implementations.
 * 
 * @example
 * ```typescript
 * import { ZodTool, McpTool, OpenApiTool, ToolRegistry } from '@robota-sdk/tools';
 * import { z } from 'zod';
 * 
 * // Zod-based tool
 * const zodTool = new ZodTool({
 *   name: 'calculator',
 *   description: 'Perform calculations',
 *   parameters: z.object({
 *     operation: z.enum(['add', 'subtract']),
 *     a: z.number(),
 *     b: z.number()
 *   }),
 *   execute: async (params) => {
 *     const result = params.operation === 'add' ? params.a + params.b : params.a - params.b;
 *     return { status: 'success', data: result };
 *   }
 * });
 * 
 * // Tool registry
 * const registry = new ToolRegistry();
 * registry.register(zodTool);
 * ```
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