/**
 * `robota mcp login <name> [--client-secret] [--no-browser]` and `robota mcp logout <name>`: sign
 * in to a configured remote MCP server that declares `oauth` and keep its tokens for later
 * sessions, or sign out of it.
 *
 * The server is found among the same resolved definitions a session would connect to, so a login
 * is stored — and a logout deleted — under the identity that session looks it up by. A client
 * secret, and a redirect URL pasted with `--no-browser`, are asked for here, never taken from an
 * argument, a definition or the environment, and never echoed.
 */

import {
  MCPOAuthError,
  isBlockedByManagedFailure,
  runMCPOAuthLogin,
  runMCPOAuthLogout,
  securityIdentity,
  createFileOAuthCredentialStore,
  createFileOAuthRefreshLock,
} from '@robota-sdk/agent-mcp';

import { openInBrowser } from './browser-opener.js';
import { HiddenPromptTooLongError, promptHiddenLine } from './hidden-prompt.js';
import { resolveMcpDefinitions } from './mcp-definition-sources.js';
import { MAX_PASTED_REDIRECT_LENGTH, mcpCredentialDirectory } from './mcp-oauth-host.js';

import type { TSettingsSource } from '@robota-sdk/agent-framework';
import type {
  IMCPOAuthLogoutResult,
  IMCPOAuthNetwork,
  IMCPResolvedEntry,
  IMCPServerDefinitionResolved,
} from '@robota-sdk/agent-mcp';

export interface IMcpLoginCommandDeps {
  readonly settingsSources: readonly TSettingsSource[];
  readonly env: NodeJS.ProcessEnv;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Defaults to the platform browser; tests inject one. */
  readonly openBrowser?: (url: URL) => Promise<void>;
  readonly promptSecret?: () => Promise<string>;
  /** Reads the redirect URL pasted with `--no-browser`; defaults to a hidden prompt. */
  readonly promptRedirect?: (signal: AbortSignal) => Promise<string>;
  readonly network?: IMCPOAuthNetwork;
  /** Defaults to `~/.robota/mcp-credentials`. */
  readonly credentialDirectory?: string;
  readonly callbackTimeoutMs?: number;
}

const LOGIN_USAGE = 'Usage: robota mcp login <name> [--client-secret] [--no-browser]\n';
const LOGOUT_USAGE = 'Usage: robota mcp logout <name>\n';

const TOKEN_LABEL = { refresh_token: 'refresh token', access_token: 'access token' } as const;

/** What revocation did, by fixed words and reasons only. */
function revocationMessage(result: IMCPOAuthLogoutResult): string {
  const failure = result.revocationFailure ?? 'revocation-failed';
  switch (result.revocation) {
    case 'revoked':
      return 'The tokens were revoked.';
    case 'not-attempted':
      return 'There were no tokens to revoke.';
    case 'unsupported':
      return 'The authorization server offers no token revocation; the tokens stay valid until they expire.';
    case 'failed':
      return `Token revocation failed (${failure}); the tokens stay valid until they expire.`;
    case 'partial':
      return (result.tokens ?? [])
        .map((token) =>
          token.revoked
            ? `The ${TOKEN_LABEL[token.token]} was revoked.`
            : `The ${TOKEN_LABEL[token.token]} was not (${token.failure ?? 'revocation-failed'}) and stays valid until it expires.`,
        )
        .join(' ');
  }
}

interface IOAuthServer {
  readonly entry: IMCPResolvedEntry;
  readonly definition: IMCPServerDefinitionResolved;
}

/** The named server's definition when it can be signed in to; otherwise reports why, and undefined. */
function findOAuthServer(name: string, deps: IMcpLoginCommandDeps): IOAuthServer | undefined {
  const { entries } = resolveMcpDefinitions(deps.settingsSources, deps.env);
  const entry = entries.find((candidate) => candidate.name === name);
  if (entry === undefined) {
    deps.stderr(`No MCP server named "${name}" is configured.\n`);
    return undefined;
  }
  if (isBlockedByManagedFailure(entry)) {
    deps.stderr(`MCP server "${name}" is blocked: the managed MCP source could not be read.\n`);
    return undefined;
  }
  const definition = entry.definition;
  if (entry.status !== 'resolved' || definition === undefined) {
    deps.stderr(`MCP server "${name}" cannot be used: ${entry.problem?.reason ?? 'unresolved'}.\n`);
    return undefined;
  }
  if (definition.transport !== 'http' || definition.oauth === undefined) {
    deps.stderr(
      `MCP server "${name}" does not declare \`oauth\`; there is nothing to sign in to.\n`,
    );
    return undefined;
  }
  if (definition.unsetVariables.some((unset) => unset.field === 'url')) {
    deps.stderr(`MCP server "${name}" has an unset variable in its url.\n`);
    return undefined;
  }
  return { entry, definition };
}

function onlyName(
  args: readonly string[],
  flags: readonly string[],
  usage: string,
  deps: IMcpLoginCommandDeps,
): string | undefined {
  const positional = args.filter((arg) => !flags.includes(arg));
  const name = positional[0];
  if (positional.length !== 1 || name === undefined || name.startsWith('-')) {
    deps.stderr(usage);
    return undefined;
  }
  return name;
}

export async function runMcpLoginCommand(
  args: readonly string[],
  deps: IMcpLoginCommandDeps,
): Promise<number> {
  const withSecret = args.includes('--client-secret');
  const noBrowser = args.includes('--no-browser');
  const name = onlyName(args, ['--client-secret', '--no-browser'], LOGIN_USAGE, deps);
  if (name === undefined) return 1;
  const server = findOAuthServer(name, deps);
  if (server === undefined) return 1;
  const { entry, definition } = server;
  const oauth = definition.oauth ?? {};
  let clientSecret: string | undefined;
  if (withSecret) {
    if (oauth.clientId === undefined) {
      deps.stderr(
        `MCP server "${name}" registers its client dynamically; a client secret needs \`oauth.clientId\`.\n`,
      );
      return 1;
    }
    try {
      clientSecret = await (deps.promptSecret ?? (() => promptHiddenLine('Client secret: ')))();
    } catch {
      deps.stderr('No client secret was read.\n');
      return 1;
    }
    if (clientSecret === '') {
      deps.stderr('No client secret was read.\n');
      return 1;
    }
  }

  const open = deps.openBrowser ?? ((url: URL) => openInBrowser(url));
  const prompt =
    deps.promptRedirect ??
    ((signal: AbortSignal) =>
      promptHiddenLine('Redirect URL (not echoed): ', undefined, {
        signal,
        maxLength: MAX_PASTED_REDIRECT_LENGTH,
      }));
  const readRedirect = (signal: AbortSignal): Promise<string> =>
    prompt(signal).catch((error: unknown) => {
      throw error instanceof HiddenPromptTooLongError
        ? new MCPOAuthError('redirect-too-long')
        : error;
    });
  const directory = deps.credentialDirectory ?? mcpCredentialDirectory();
  try {
    await runMCPOAuthLogin({
      securityIdentity: securityIdentity(entry),
      serverUrl: definition.url ?? '',
      config: oauth,
      ...(clientSecret === undefined ? {} : { clientSecret }),
      store: createFileOAuthCredentialStore(directory),
      lock: createFileOAuthRefreshLock(directory),
      network: deps.network ?? {},
      ...(deps.callbackTimeoutMs === undefined
        ? {}
        : { callbackTimeoutMs: deps.callbackTimeoutMs }),
      ...(noBrowser ? { readRedirect } : {}),
      openBrowser: async (url, redirectUri) => {
        if (noBrowser) {
          deps.stdout(
            `To sign in to MCP server "${name}", open this URL in a browser:\n${url.href}\n\n` +
              `After you approve, the browser is sent to ${redirectUri}, which may not load.\n` +
              'Copy the full address from its address bar and paste it here.\n',
          );
          return;
        }
        deps.stdout(
          `Opening your browser to sign in to MCP server "${name}".\n` +
            `If it does not open, visit:\n${url.href}\n`,
        );
        // The URL is printed above; a browser that did not open is not a failed sign-in.
        await open(url).catch(() => deps.stderr('The browser could not be opened.\n'));
      },
    });
  } catch (error) {
    const reason = error instanceof MCPOAuthError ? error.reason : 'unexpected-error';
    deps.stderr(`Sign-in to MCP server "${name}" failed (${reason}).\n`);
    return 1;
  }
  deps.stdout(`Signed in to MCP server "${name}".\n`);
  return 0;
}

export async function runMcpLogoutCommand(
  args: readonly string[],
  deps: IMcpLoginCommandDeps,
): Promise<number> {
  const name = onlyName(args, [], LOGOUT_USAGE, deps);
  if (name === undefined) return 1;
  const server = findOAuthServer(name, deps);
  if (server === undefined) return 1;
  const directory = deps.credentialDirectory ?? mcpCredentialDirectory();
  let result: IMCPOAuthLogoutResult;
  try {
    result = await runMCPOAuthLogout({
      securityIdentity: securityIdentity(server.entry),
      serverUrl: server.definition.url ?? '',
      store: createFileOAuthCredentialStore(directory),
      lock: createFileOAuthRefreshLock(directory),
      network: deps.network ?? {},
    });
  } catch (error) {
    const reason = error instanceof MCPOAuthError ? error.reason : 'unexpected-error';
    deps.stderr(`Sign-out of MCP server "${name}" failed (${reason}).\n`);
    return 1;
  }
  deps.stdout(
    `${result.removed ? 'Signed out of' : 'Not signed in to'} MCP server "${name}". ` +
      `${revocationMessage(result)}\n`,
  );
  return 0;
}
