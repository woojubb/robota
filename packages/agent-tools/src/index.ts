// @robota-sdk/agent-tools
//
// Everything on this entry is platform-neutral (ARCHITECTURE.md "Runtime platforms") except the one
// block at the end. What touches a host — the shell, file, search and web-fetch tools, the OS sandbox
// and the host reads of a workspace manifest — is on `@robota-sdk/agent-tools/node`.

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

// SELFHOST-010: computer-use (driver port + types + perceive/act tool factory + zero-dep reference adapter).
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

// FunctionTool and ToolRegistry classes are owned by @robota-sdk/agent-core (DATA-005 SSOT).
// agent-tools exposes only the factories that construct core's FunctionTool.
export { createFunctionTool, createZodFunctionTool } from './implementations/function-tool';
export type { IFunctionToolResidencyOptions } from './implementations/function-tool';
// zodToJsonSchema and the Zod compatibility types moved to @robota-sdk/agent-core (CORE-015 SSOT).
export type {
  IFunctionToolValidationOptions,
  IFunctionToolExecutionMetadata,
  IFunctionToolResult,
} from './implementations/function-tool/types';

// Built-in tools that need no host: the model asks the user, and searches the deferred tool catalog.
export { askUserQuestionTool, createAskUserQuestionTool } from './builtins/ask-user-question-tool';
// CLI-1990: the resident tool that loads deferred schemas on demand, and its pure match/rank half.
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

// Node-only, and here only because the published @robota-sdk/workflows 0.0.3, which agent-cli
// bundles, imports exactly these names from this entry. They leave when the next workflows release
// moves to `@robota-sdk/agent-tools/node` and is pinned; only then does this entry lose
// `"browser": null`. Nothing in this repository imports them from here.
export {
  GrepIsolationError,
  ReadByteLimitError,
  ReadCancelledError,
  createBashTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createReadTool,
  createShellTool,
  createWriteTool,
  webFetchTool,
} from './node.js';
