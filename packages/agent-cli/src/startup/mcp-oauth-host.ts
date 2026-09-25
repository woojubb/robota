/**
 * The product's OAuth host for remote MCP servers: where credentials are kept, and how a
 * server's OAuth authenticator is built and what it tells the user.
 *
 * Credentials live under `~/.robota/mcp-credentials/`, owner-only. The file store is one backend of
 * `agent-mcp`'s credential store port; the refresh lock beside it is the caller's, so a different
 * backend changes the store and nothing else.
 */

import { join } from 'node:path';

import { shellArgumentForDisplay } from '@robota-sdk/agent-core';

import {
  MCPOAuthError,
  createFileOAuthCredentialStore,
  createFileOAuthRefreshLock,
  createOAuthAuthenticator,
  readMCPOAuthCredentialState,
  runMCPOAuthLogin,
  runMCPOAuthLogout,
} from '@robota-sdk/agent-mcp';

import { userLocalStorageRoot } from '../product/user-paths.js';
import { openInBrowser } from './browser-opener.js';

import type { ICommandMCPOAuthRedirectPrompt } from '@robota-sdk/agent-framework';
import type { IMCPOAuthNetwork, TMCPOAuthNotice } from '@robota-sdk/agent-mcp';
import type { IMcpOAuthHost } from './mcp-client-composition.js';

/** The directory OAuth credentials and their refresh locks are kept in. */
export function mcpCredentialDirectory(home?: string): string {
  return join(userLocalStorageRoot(home), 'mcp-credentials');
}

/** What JSON leaves unescaped but a terminal would act on or hide: DEL, C1 controls, separators, format characters. */
const INVISIBLE = /[\u007f-\u009f\u2028\u2029\p{Cf}]/gu;

/** A name a repository chose, quoted, with every control and format character escaped. */
function quotedName(name: string): string {
  return JSON.stringify(name).replace(INVISIBLE, (char) => {
    const code = (char.codePointAt(0) ?? 0).toString(16);
    return code.length > 4 ? `\\u{${code}}` : `\\u${code.padStart(4, '0')}`;
  });
}

/** What the user is told; the server's name and scope tokens only. */
export function formatMcpOAuthNotice(notice: TMCPOAuthNotice): string {
  if (notice.kind === 'login-required') {
    // A repository may name the server: it goes into the command only when it is safe to paste.
    const argument = shellArgumentForDisplay(notice.serverId);
    const shown = argument ?? '<server>';
    const how = `run /mcp login ${shown} in this session, or robota mcp login ${shown} in a terminal`;
    return argument === undefined
      ? `An MCP server whose name cannot be shown safely needs you to sign in: ${how}`
      : `MCP server ${argument} needs you to sign in: ${how}`;
  }
  const name = quotedName(notice.serverId);
  return notice.scope === undefined
    ? `MCP server ${name} refused the request: the signed-in account lacks a required scope.`
    : `MCP server ${name} refused the request: it requires the scope "${notice.scope}".`;
}

/** Room for a long authorization code and state; a paste longer than this is not a redirect. */
export const MAX_PASTED_REDIRECT_LENGTH = 16_384;

export function createMcpOAuthHost(options: {
  readonly network: IMCPOAuthNetwork;
  readonly reportDiagnostic: (message: string) => void;
  readonly directory?: string;
  /** Defaults to the platform browser; tests inject one. */
  readonly openBrowser?: (url: URL) => Promise<void>;
  readonly callbackTimeoutMs?: number;
}): IMcpOAuthHost {
  const directory = options.directory ?? mcpCredentialDirectory();
  const store = createFileOAuthCredentialStore(directory);
  const lock = createFileOAuthRefreshLock(directory);
  const open = options.openBrowser ?? ((url: URL) => openInBrowser(url));
  /** Servers this session was told need a sign-in; nothing stored for them reads as that. */
  const signInAsked = new Set<string>();
  return {
    signIn: async (request, definition, { noBrowser, readRedirect }) => {
      let prompt: ICommandMCPOAuthRedirectPrompt | undefined;
      const paste =
        readRedirect === undefined
          ? undefined
          : async (signal: AbortSignal): Promise<string> => {
              // Asked for only after the authorization URL is known, so it is always shown.
              if (prompt === undefined) throw new MCPOAuthError('cancelled');
              const pasted = await readRedirect(prompt, signal);
              if (pasted.length > MAX_PASTED_REDIRECT_LENGTH) {
                throw new MCPOAuthError('redirect-too-long');
              }
              return pasted;
            };
      await runMCPOAuthLogin({
        securityIdentity: request.securityIdentity,
        serverUrl: definition.url ?? '',
        config: definition.oauth ?? {},
        store,
        lock,
        network: options.network,
        ...(options.callbackTimeoutMs === undefined
          ? {}
          : { callbackTimeoutMs: options.callbackTimeoutMs }),
        ...(paste === undefined
          ? {}
          : noBrowser
            ? { readRedirect: paste }
            : { readRedirectWhenBrowserFails: paste }),
        openBrowser: async (url, redirectUri) => {
          prompt = { authorizationUrl: url.href, redirectUri };
          if (!noBrowser) await open(url);
        },
      });
      signInAsked.delete(request.serverId);
    },
    authenticatorFor: (request, definition) =>
      createOAuthAuthenticator({
        serverId: request.serverId,
        securityIdentity: request.securityIdentity,
        serverUrl: definition.url ?? '',
        config: definition.oauth ?? {},
        store,
        lock,
        network: options.network,
        notify: (notice) => {
          if (notice.kind === 'login-required') signInAsked.add(request.serverId);
          options.reportDiagnostic(formatMcpOAuthNotice(notice));
        },
      }),
    state: async (request, definition) => {
      const state = await readMCPOAuthCredentialState({
        securityIdentity: request.securityIdentity,
        serverUrl: definition.url ?? '',
        store,
      });
      return state === 'signed-out' && signInAsked.has(request.serverId)
        ? 'sign-in-required'
        : state;
    },
    signOut: async (request, definition) => {
      const result = await runMCPOAuthLogout({
        securityIdentity: request.securityIdentity,
        serverUrl: definition.url ?? '',
        store,
        lock,
        network: options.network,
      });
      signInAsked.delete(request.serverId);
      return result;
    },
  };
}
