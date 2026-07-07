// Browser-safe entry point for @robota-sdk/agent-tools.
// Excludes Node.js-only tools (bash, read, write, edit, glob, grep, web-fetch, web-search)
// and the sandbox clients that depend on Node.js APIs.

export type { IToolInvocationResult } from './types/tool-result';

// FunctionTool and ToolRegistry classes are owned by @robota-sdk/agent-core (DATA-005 SSOT).
// agent-tools exposes only the factories that construct core's FunctionTool.
export { createFunctionTool, createZodFunctionTool } from './implementations/function-tool';
// zodToJsonSchema and the Zod compatibility types moved to @robota-sdk/agent-core (CORE-015 SSOT).
export type {
  IFunctionToolValidationOptions,
  IFunctionToolExecutionMetadata,
  IFunctionToolResult,
} from './implementations/function-tool/types';
