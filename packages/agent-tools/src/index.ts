// @robota-sdk/agent-tools

// Tool result type
export type { TToolResult } from './types/tool-result';
export { E2BSandboxClient, InMemorySandboxClient } from './sandbox/index';
export type {
  IE2BSandboxAdapter,
  IE2BSandboxClientOptions,
  ISandboxClient,
  ISandboxRunOptions,
  ISandboxRunResult,
  ISandboxToolOptions,
  IInMemorySandboxClientOptions,
  TInMemorySandboxRunHandler,
} from './sandbox/index';

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
export { bashTool, createBashTool } from './builtins/bash-tool';
export { readTool, createReadTool } from './builtins/read-tool';
export { writeTool, createWriteTool } from './builtins/write-tool';
export { editTool, createEditTool } from './builtins/edit-tool';
export { globTool } from './builtins/glob-tool';
export { grepTool } from './builtins/grep-tool';
export { webFetchTool } from './builtins/web-fetch-tool';
export { webSearchTool } from './builtins/web-search-tool';
