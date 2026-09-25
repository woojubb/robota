/**
 * The product's OAuth host for remote MCP servers: where credentials are kept, and how a
 * server's OAuth authenticator is built and what it tells the user.
 *
 * Credentials live under `~/.robota/mcp-credentials/`, owner-only. The file store is one backend of
 * `agent-mcp`'s credential store port; the refresh lock beside it is the caller's, so a different
 * backend changes the store and nothing else.
 */

import { join } from 'node:path';

import {
  createFileOAuthCredentialStore,
  createFileOAuthRefreshLock,
  createOAuthAuthenticator,
} from '@robota-sdk/agent-mcp';

import { userLocalStorageRoot } from '../product/user-paths.js';

import type { IMCPOAuthNetwork, TMCPOAuthNotice } from '@robota-sdk/agent-mcp';
import type { IMcpOAuthHost } from './mcp-client-composition.js';

/** The directory OAuth credentials and their refresh locks are kept in. */
export function mcpCredentialDirectory(home?: string): string {
  return join(userLocalStorageRoot(home), 'mcp-credentials');
}

/** What the user is told; the server's name and scope tokens only. */
export function formatMcpOAuthNotice(notice: TMCPOAuthNotice): string {
  if (notice.kind === 'login-required') {
    return `MCP server "${notice.serverId}" needs you to sign in: run /mcp login ${notice.serverId}`;
  }
  return notice.scope === undefined
    ? `MCP server "${notice.serverId}" refused the request: the signed-in account lacks a required scope.`
    : `MCP server "${notice.serverId}" refused the request: it requires the scope "${notice.scope}".`;
}

export function createMcpOAuthHost(options: {
  readonly network: IMCPOAuthNetwork;
  readonly reportDiagnostic: (message: string) => void;
  readonly directory?: string;
}): IMcpOAuthHost {
  const directory = options.directory ?? mcpCredentialDirectory();
  const store = createFileOAuthCredentialStore(directory);
  const lock = createFileOAuthRefreshLock(directory);
  return {
    authenticatorFor: (request, definition) =>
      createOAuthAuthenticator({
        serverId: request.serverId,
        securityIdentity: request.securityIdentity,
        serverUrl: definition.url ?? '',
        config: definition.oauth ?? {},
        store,
        lock,
        network: options.network,
        notify: (notice) => options.reportDiagnostic(formatMcpOAuthNotice(notice)),
      }),
  };
}
