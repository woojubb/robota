// Browser-safe entry point for @robota-sdk/agent-tools.
// Excludes Node.js-only tools (bash, read, write, edit, glob, grep, web-fetch, web-search)
// and the sandbox clients that depend on Node.js APIs.

export type { IToolInvocationResult } from './types/tool-result';

export { ToolRegistry } from './registry/tool-registry';

export {
  FunctionTool,
  createFunctionTool,
  createZodFunctionTool,
} from './implementations/function-tool';
// zodToJsonSchema and the Zod compatibility types moved to @robota-sdk/agent-core (CORE-015 SSOT).
export type {
  IFunctionToolValidationOptions,
  IFunctionToolExecutionMetadata,
  IFunctionToolResult,
} from './implementations/function-tool/types';
