// @robota-sdk/agent-tools
//
// Everything on this entry is platform-neutral (ARCHITECTURE.md "Runtime platforms"). What touches a
// host — the shell, file, search and web-fetch tools, the OS sandbox and the host reads of a
// workspace manifest — is on `@robota-sdk/agent-tools/node`.

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
  IWorkspaceHostDirectoryEntry,
  IWorkspaceHostFiles,
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
  TSandboxFilesystem,
  TExecutionContainment,
  ICommandInvocation,
} from './sandbox/index';
export {
  applyWorkspaceManifest,
  validateWorkspaceManifestPath,
  describeExecutionContainment,
  routesFilesThroughSandbox,
} from './sandbox/index';

// Codebase retrieval (port + types + neutral repo-map ranking adapter; tool added below)
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
  IRepoMapIndexEntry,
  IRepoMapIndex,
  IRepoMapIndexChanges,
  IBuildRepoMapIndexOptions,
} from './retrieval/index';
export {
  RepoMapRetrievalAdapter,
  createRetrievalTool,
  buildRepoMapIndex,
  updateRepoMapIndex,
  serializeRepoMapIndex,
  deserializeRepoMapIndex,
  REPO_MAP_INDEX_VERSION,
} from './retrieval/index';

// Computer-use (driver port + types + perceive/act tool factory + zero-dep reference adapter).
// The test-support ScriptedComputerDriver is NOT exported here — it lives under computer-use/testing/.
export type {
  IBrowserPageAdapter,
  IBrowserPageKeyboardAdapter,
  IBrowserPageMouseAdapter,
  IComputerActionResult,
  IComputerClickAction,
  IComputerDoubleClickAction,
  IComputerDragAction,
  IComputerDriver,
  IComputerKeypressAction,
  IComputerPoint,
  IComputerScreenshot,
  IComputerScrollAction,
  IComputerTakeoverAction,
  IComputerToolOptions,
  IComputerToolResult,
  IComputerTypeAction,
  IComputerWaitAction,
  IPageComputerDriverOptions,
  TComputerAction,
  TComputerActionType,
  TComputerMouseButton,
} from './computer-use/index';
export {
  createComputerActTool,
  createComputerTool,
  createComputerViewTool,
  PageComputerDriver,
} from './computer-use/index';

// FunctionTool and ToolRegistry classes are owned by @robota-sdk/agent-core (SSOT).
// agent-tools exposes only the factories that construct core's FunctionTool.
export { createFunctionTool, createZodFunctionTool } from './implementations/function-tool';
export type { IFunctionToolResidencyOptions } from './implementations/function-tool';
// zodToJsonSchema and the Zod compatibility types moved to @robota-sdk/agent-core (SSOT).
export type {
  IFunctionToolValidationOptions,
  IFunctionToolExecutionMetadata,
  IFunctionToolResult,
} from './implementations/function-tool/types';

// Built-in tools that need no host: the model asks the user, and searches the deferred tool catalog.
export { askUserQuestionTool, createAskUserQuestionTool } from './builtins/ask-user-question-tool';
// The resident tool that loads deferred schemas on demand, and its pure match/rank half.
export {
  toolSearchTool,
  createToolSearchTool,
  TOOL_SEARCH_NAME,
} from './builtins/tool-search-tool';
export type { IToolSearchOutput } from './builtins/tool-search-tool';
export { DEFAULT_TOOL_SEARCH_LIMIT, matchDeferredTools } from './builtins/tool-search-matching';
export type {
  IBuiltinToolDescriptionOptions,
  IContainedBuiltinToolOptions,
  IFileBuiltinToolOptions,
  ISandboxBuiltinToolOptions,
} from './builtins/tool-options';
export type { IEditorFileAccess, IEditorFileOptions } from './builtins/editor-files';
