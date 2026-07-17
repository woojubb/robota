// @robota-sdk/agent-tools

// Tool result type
export type { IToolInvocationResult } from './types/tool-result';
export { E2BSandboxClient, InMemorySandboxClient } from './sandbox/index';
export type {
  IE2BSandboxAdapter,
  IE2BSandboxClientOptions,
  ISandboxClient,
  ISandboxRunOptions,
  ISandboxRunResult,
  ISandboxToolOptions,
  IWorkspaceManifest,
  IWorkspaceManifestAppliedEntry,
  IWorkspaceManifestApplyOptions,
  IWorkspaceManifestApplyResult,
  IWorkspaceManifestAzureBlobMountEntry,
  IWorkspaceManifestDirectoryEntry,
  IWorkspaceManifestFileEntry,
  IWorkspaceManifestGcsMountEntry,
  IWorkspaceManifestGitRepositoryEntry,
  IWorkspaceManifestLocalDirectoryEntry,
  IWorkspaceManifestLocalFileEntry,
  IWorkspaceManifestPermissions,
  IWorkspaceManifestR2MountEntry,
  IWorkspaceManifestS3MountEntry,
  IInMemorySandboxClientOptions,
  TWorkspaceManifestApplyStatus,
  TWorkspaceManifestEntry,
  TInMemorySandboxRunHandler,
} from './sandbox/index';
export { applyWorkspaceManifest, validateWorkspaceManifestPath } from './sandbox/index';

// SELFHOST-003: codebase retrieval (port + types + neutral repo-map ranking adapter; tool added below)
export type {
  IRetrievalSymbol,
  IRetrievalParsedFile,
  IRetrievalSourceParser,
  IRetrievalCorpusFile,
  IRetrievalRequest,
  IRetrievalRankedSymbol,
  IRetrievalResult,
  IRetrievalAdapter,
  IRetrievalToolOptions,
  IRepoMapRetrievalAdapterOptions,
} from './retrieval/index';
export { RepoMapRetrievalAdapter } from './retrieval/index';

// FunctionTool and ToolRegistry classes are owned by @robota-sdk/agent-core (DATA-005 SSOT).
// agent-tools exposes only the factories that construct core's FunctionTool.
export { createFunctionTool, createZodFunctionTool } from './implementations/function-tool';
// zodToJsonSchema and the Zod compatibility types moved to @robota-sdk/agent-core (CORE-015 SSOT).
export type {
  IFunctionToolValidationOptions,
  IFunctionToolExecutionMetadata,
  IFunctionToolResult,
} from './implementations/function-tool/types';

// Built-in CLI tools
export { shellTool, createShellTool, bashTool, createBashTool } from './builtins/shell-tool';
export { readTool, createReadTool } from './builtins/read-tool';
export { writeTool, createWriteTool } from './builtins/write-tool';
export { editTool, createEditTool } from './builtins/edit-tool';
export { globTool } from './builtins/glob-tool';
export { grepTool } from './builtins/grep-tool';
export { webFetchTool } from './builtins/web-fetch-tool';
export { webSearchTool } from './builtins/web-search-tool';
export { askUserQuestionTool, createAskUserQuestionTool } from './builtins/ask-user-question-tool';
