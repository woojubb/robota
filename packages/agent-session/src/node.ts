// @robota-sdk/agent-session/node — what only a Node host can provide. The main entry is
// platform-neutral and takes each of these by injection (ARCHITECTURE.md "Runtime platforms").

export { registerProcessExitFlush } from './process-exit-flush.js';
export { createNodeWorkspacePathResolver } from './workspace-path-resolver.js';
