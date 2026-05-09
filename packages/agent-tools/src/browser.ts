// Browser-safe entry point for @robota-sdk/agent-tools.
// Excludes Node.js-only tools (bash, read, write, edit, glob, grep, web-fetch, web-search)
// and the sandbox clients that depend on Node.js APIs.

export type { TToolResult } from './types/tool-result';

export { ToolRegistry } from './registry/tool-registry';

export {
  FunctionTool,
  createFunctionTool,
  createZodFunctionTool,
} from './implementations/function-tool';
export { OpenAPITool, createOpenAPITool } from './implementations/openapi-tool';
export { zodToJsonSchema } from './implementations/function-tool/schema-converter';
export type {
  IZodSchema,
  IZodParseResult,
  IZodSchemaDef,
  IFunctionToolValidationOptions,
  ISchemaConversionOptions,
  IFunctionToolExecutionMetadata,
  IFunctionToolResult,
} from './implementations/function-tool/types';
