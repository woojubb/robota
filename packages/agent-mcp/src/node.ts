// @robota-sdk/agent-mcp/node — what only a Node host can provide: the stdio transport and the
// authority that admits a child process, the owner-only OAuth credential files and refresh lock, the
// loopback listener a sign-in redirects to, and the Node egress of the HTTP transport (it resolves
// names, refuses private addresses and pins the connection). The main entry is platform-neutral
// (ARCHITECTURE.md "Runtime platforms") and takes each of these by injection.

export { createStdioAdapter } from './node/stdio.js';
export type {
  IMCPAdmittedStdioEndpoint,
  IMCPStdioAdapterOptions,
  IMCPStdioAuthority,
  IMCPStdioExecutable,
  IMCPStdioInput,
} from './node/stdio-types.js';
export { createNodeHttpEgress } from './node/http-egress.js';
export type { INodeHttpEgressOptions } from './node/http-egress.js';
export { createNodeOAuthNetwork } from './node/oauth-network.js';
export type { INodeOAuthNetworkOptions } from './node/oauth-network.js';
export { createFileOAuthCredentialStore } from './node/oauth-file-store.js';
export { createFileOAuthRefreshLock } from './node/oauth-refresh-lock.js';
export type { IFileOAuthRefreshLockOptions } from './node/oauth-refresh-lock.js';
export {
  freeLoopbackPort,
  loopbackOAuthCallbackListener,
  startOAuthCallbackServer,
} from './node/oauth-callback.js';
