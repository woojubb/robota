/**
 * `robota mcp login <name> [--client-secret]`: sign in to a configured remote MCP server that
 * declares `oauth`, and keep its tokens for later sessions.
 *
 * The server is found among the same resolved definitions a session would connect to, so a login
 * is stored under the identity that session will look it up by. A client secret is asked for here,
 * never taken from an argument, a definition or the environment.
 */

import {
  MCPOAuthError,
  isBlockedByManagedFailure,
  runMCPOAuthLogin,
  securityIdentity,
  createFileOAuthCredentialStore,
} from '@robota-sdk/agent-mcp';

import { openInBrowser } from './browser-opener.js';
import { promptHiddenLine } from './hidden-prompt.js';
import { resolveMcpDefinitions } from './mcp-definition-sources.js';
import { mcpCredentialDirectory } from './mcp-oauth-host.js';

import type { TSettingsSource } from '@robota-sdk/agent-framework';
import type { IMCPOAuthNetwork } from '@robota-sdk/agent-mcp';

export interface IMcpLoginCommandDeps {
  readonly settingsSources: readonly TSettingsSource[];
  readonly env: NodeJS.ProcessEnv;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Defaults to the platform browser; tests inject one. */
  readonly openBrowser?: (url: URL) => Promise<void>;
  readonly promptSecret?: () => Promise<string>;
  readonly network?: IMCPOAuthNetwork;
  /** Defaults to `~/.robota/mcp-credentials`. */
  readonly credentialDirectory?: string;
  readonly callbackTimeoutMs?: number;
}

const USAGE = 'Usage: robota mcp login <name> [--client-secret]\n';

export async function runMcpLoginCommand(
  args: readonly string[],
  deps: IMcpLoginCommandDeps,
): Promise<number> {
  const withSecret = args.includes('--client-secret');
  const positional = args.filter((arg) => arg !== '--client-secret');
  const name = positional[0];
  if (positional.length !== 1 || name === undefined || name.startsWith('-')) {
    deps.stderr(USAGE);
    return 1;
  }
  const { entries } = resolveMcpDefinitions(deps.settingsSources, deps.env);
  const entry = entries.find((candidate) => candidate.name === name);
  if (entry === undefined) {
    deps.stderr(`No MCP server named "${name}" is configured.\n`);
    return 1;
  }
  if (isBlockedByManagedFailure(entry)) {
    deps.stderr(`MCP server "${name}" is blocked: the managed MCP source could not be read.\n`);
    return 1;
  }
  const definition = entry.definition;
  if (entry.status !== 'resolved' || definition === undefined) {
    deps.stderr(`MCP server "${name}" cannot be used: ${entry.problem?.reason ?? 'unresolved'}.\n`);
    return 1;
  }
  if (definition.transport !== 'http' || definition.oauth === undefined) {
    deps.stderr(
      `MCP server "${name}" does not declare \`oauth\`; there is nothing to sign in to.\n`,
    );
    return 1;
  }
  if (definition.unsetVariables.some((unset) => unset.field === 'url')) {
    deps.stderr(`MCP server "${name}" has an unset variable in its url.\n`);
    return 1;
  }
  let clientSecret: string | undefined;
  if (withSecret) {
    if (definition.oauth.clientId === undefined) {
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
  try {
    await runMCPOAuthLogin({
      securityIdentity: securityIdentity(entry),
      serverUrl: definition.url ?? '',
      config: definition.oauth,
      ...(clientSecret === undefined ? {} : { clientSecret }),
      store: createFileOAuthCredentialStore(deps.credentialDirectory ?? mcpCredentialDirectory()),
      network: deps.network ?? {},
      ...(deps.callbackTimeoutMs === undefined
        ? {}
        : { callbackTimeoutMs: deps.callbackTimeoutMs }),
      openBrowser: async (url) => {
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
