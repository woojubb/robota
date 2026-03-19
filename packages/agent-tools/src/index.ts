// @robota-sdk/agent-tools

// Tool result type
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

// Built-in CLI tools
export { bashTool } from './builtins/bash-tool';
export { readTool } from './builtins/read-tool';
export { writeTool } from './builtins/write-tool';
export { editTool } from './builtins/edit-tool';
export { globTool } from './builtins/glob-tool';
export { grepTool } from './builtins/grep-tool';
