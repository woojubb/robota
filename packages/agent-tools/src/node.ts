// @robota-sdk/agent-tools/node — what only a Node host can run: the shell, file, search and
// web-fetch tools, the OS sandbox and the host-file reads of a workspace manifest. The main entry is
// platform-neutral (ARCHITECTURE.md "Runtime platforms") and takes a host's pieces by injection; the
// one exception is the block at the end of `index.ts` that re-exports eleven of these names.

export { createShellTool, createBashTool } from './builtins/shell-tool.js';
export type { IShellToolOptions } from './builtins/shell-tool.js';
export { createReadTool, ReadByteLimitError, ReadCancelledError } from './builtins/read-tool.js';
export { createWriteTool } from './builtins/write-tool.js';
export { createEditTool } from './builtins/edit-tool.js';
export { createGlobTool } from './builtins/glob-tool.js';
export { createGrepTool, GrepIsolationError } from './builtins/grep-tool.js';
export type { IGrepToolOptions } from './builtins/grep-tool.js';
export { webFetchTool, createWebFetchTool } from './builtins/web-fetch-tool.js';
export type { IWebFetchToolOptions } from './builtins/web-fetch-tool.js';

export {
  DEFAULT_OS_SANDBOX_SETTINGS,
  detectOsSandbox,
  OsSandboxClient,
} from './sandbox/os-sandbox-client.js';
export type {
  IDetectOsSandboxOptions,
  IOsSandboxAvailability,
  IOsSandboxClientOptions,
  IOsSandboxSettings,
  IOsSandboxStatus,
  TOsSandboxBackend,
} from './sandbox/os-sandbox-client.js';
export {
  bubblewrapArguments,
  protectedWorkspaceEntries,
  seatbeltProfile,
} from './sandbox/os-sandbox-policy.js';
export type { IBubblewrapInput, IOsSandboxPolicy } from './sandbox/os-sandbox-policy.js';

export { createNodeWorkspaceHostFiles } from './sandbox/node-workspace-host-files.js';
