import { shellArgumentForDisplay } from '@robota-sdk/agent-core';

import { mcpModelStatusResult } from './mcp-model-status.js';

import type {
  ICommandHostAdapterAccess,
  ICommandHostWorkspace,
  ICommandMCPActivationAdapter,
  ICommandMCPActivationSummary,
  ICommandMCPOAuthLogoutResult,
  ICommandMCPOAuthStatus,
  ICommandMCPSourceProblem,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

function adapter(context: ICommandHostAdapterAccess): ICommandMCPActivationAdapter | undefined {
  return context.getCommandHostAdapters?.().mcpActivation;
}

const OAUTH_STATE_LABEL: Record<ICommandMCPOAuthStatus['state'], string> = {
  'signed-in': 'signed in',
  'expired-refreshable': 'token expired, will refresh',
  'sign-in-required': 'sign-in required',
  'signed-out': 'signed out',
};

const TOKEN_LABEL = { refresh_token: 'refresh token', access_token: 'access token' } as const;

/** What revocation did, by fixed words and reasons only. */
function revocationText(result: ICommandMCPOAuthLogoutResult): string {
  const failure = result.revocationFailure ?? 'revocation-failed';
  switch (result.revocation) {
    case 'revoked':
      return 'the tokens were revoked';
    case 'not-attempted':
      return 'there were no tokens to revoke';
    case 'unsupported':
      return 'the authorization server offers no token revocation; the tokens stay valid until they expire';
    case 'failed':
      return `token revocation failed (${failure}); the tokens stay valid until they expire`;
    case 'partial':
      return (result.tokens ?? [])
        .map((token) =>
          token.revoked
            ? `the ${TOKEN_LABEL[token.token]} was revoked`
            : `the ${TOKEN_LABEL[token.token]} was not (${token.failure ?? 'revocation-failed'}) and stays valid until it expires`,
        )
        .join('; ');
  }
}

const USAGE = 'Usage: /mcp [status] | /mcp <approve|reject|revoke|logout> <serverId>';

/**
 * The terminal command that signs in to one server. Its name comes from a definition a repository
 * may write, so it is shown only when it is safe to paste into any shell; otherwise it is left out.
 */
function signInHint(serverId: string): string {
  const argument = shellArgumentForDisplay(serverId);
  return argument === undefined
    ? ' (run robota mcp login <server>; its name cannot be shown safely here)'
    : ` (run robota mcp login ${argument})`;
}

function formatSummary(
  summary: ICommandMCPActivationSummary,
  oauth: ICommandMCPOAuthStatus['state'] | undefined,
): string {
  const label = summary.displayName ? ` (${summary.displayName})` : '';
  // A fixed word per state: nothing token-derived ever reaches this line.
  const signIn =
    oauth === undefined
      ? ''
      : ` — OAuth: ${OAUTH_STATE_LABEL[oauth]}${oauth === 'sign-in-required' || oauth === 'signed-out' ? signInHint(summary.serverId) : ''}`;
  return `  ${summary.serverId}${label} — ${summary.status} — ${summary.source} — ${summary.reason}${signIn}`;
}

/**
 * Issue #2794: a source that produced no server names at all — "which file could not be read".
 *
 * `blockedServerNames` (PR #3076 review): a managed-tier problem also blocked every lower-tier
 * server that would otherwise have resolved — those names never appear in `list()` above (an
 * `unresolved` entry is never an activation candidate), so this line is the ONLY place `/mcp status`
 * says they exist at all and why they are not active.
 */
function formatSourceProblem(problem: ICommandMCPSourceProblem): string {
  const blocked = problem.blockedServerNames ?? [];
  const blockedNote = blocked.length === 0 ? '' : ` Blocked until fixed: ${blocked.join(', ')}.`;
  return `  ${problem.source} (${problem.origin}) could not be read: ${problem.reason}.${blockedNote}`;
}

async function oauthStates(
  mcp: ICommandMCPActivationAdapter,
): Promise<ReadonlyMap<string, ICommandMCPOAuthStatus['state']>> {
  const states = (await mcp.oauthStatus?.()) ?? [];
  return new Map(states.map((status) => [status.serverId, status.state]));
}

async function listResult(mcp: ICommandMCPActivationAdapter | undefined): Promise<ICommandResult> {
  if (!mcp) {
    return {
      message: 'MCP activation management is not available in this environment.',
      success: true,
    };
  }
  const entries = mcp.list();
  const oauth = await oauthStates(mcp);
  // A source-scoped problem (issue #2794) names no server, so it never appears in `entries` — it is
  // reported beside them rather than folded into the "no servers" branch, which would otherwise say
  // nothing while a managed policy sits unreadable.
  const sourceProblems = mcp.sourceProblems?.() ?? [];
  const sourceProblemLines =
    sourceProblems.length === 0
      ? []
      : [`MCP source problems:\n${sourceProblems.map(formatSourceProblem).join('\n')}`];

  if (entries.length === 0) {
    return {
      message:
        sourceProblemLines.length === 0
          ? 'No MCP definitions are registered.'
          : sourceProblemLines[0]!,
      success: true,
      data: { servers: [], sourceProblems },
    };
  }
  return {
    message: [
      `MCP activation status:\n${entries
        .map((entry) => formatSummary(entry, oauth.get(entry.serverId)))
        .join('\n')}`,
      ...sourceProblemLines,
    ].join('\n\n'),
    success: true,
    data: {
      servers: entries.map((entry) => ({
        serverId: entry.serverId,
        source: entry.source,
        status: entry.status,
        allowed: entry.allowed,
        provenanceId: entry.provenanceId,
        definitionFingerprint: entry.definitionFingerprint,
        securityIdentity: entry.securityIdentity,
        ...(oauth.has(entry.serverId) ? { oauth: oauth.get(entry.serverId) } : {}),
      })),
      sourceProblems,
    },
  };
}

export async function executeMCPActivationCommand(
  context: ICommandHostAdapterAccess &
    Partial<Pick<ICommandHostWorkspace, 'getCommandInvocationSource'>>,
  args: string,
): Promise<ICommandResult> {
  const trimmed = args.trim();
  const spaceAt = trimmed.indexOf(' ');
  const verb = (spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt)).toLowerCase();
  const serverId = spaceAt === -1 ? '' : trimmed.slice(spaceAt + 1).trim();

  if (verb === '' || verb === 'status' || verb === 'list') {
    return context.getCommandInvocationSource?.() === 'model'
      ? mcpModelStatusResult(adapter(context))
      : listResult(adapter(context));
  }

  if (verb !== 'approve' && verb !== 'reject' && verb !== 'revoke' && verb !== 'logout') {
    return { message: `Unknown argument. ${USAGE}`, success: false };
  }
  if (!serverId) {
    return {
      message: `Usage: /mcp ${verb} <serverId>`,
      success: false,
    };
  }

  const mcp = adapter(context);
  if (!mcp) {
    return {
      message: 'MCP activation management is not available in this environment.',
      success: true,
    };
  }
  if (verb === 'logout') return logoutResult(mcp, serverId);

  try {
    const result = await mcp[verb](serverId);
    return {
      message: `MCP server ${serverId} is now ${result.status}. ${result.reason}`,
      success:
        result.status === 'approved' || result.status === 'rejected' || result.status === 'revoked',
      data: {
        serverId: result.serverId,
        status: result.status,
        allowed: result.allowed,
        source: result.source,
        provenanceId: result.provenanceId,
        definitionFingerprint: result.definitionFingerprint,
        securityIdentity: result.securityIdentity,
      },
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      success: false,
    };
  }
}

async function logoutResult(
  mcp: ICommandMCPActivationAdapter,
  serverId: string,
): Promise<ICommandResult> {
  if (mcp.oauthLogout === undefined || (await oauthStates(mcp)).get(serverId) === undefined) {
    return { message: `MCP server ${serverId} does not declare OAuth.`, success: false };
  }
  let result: ICommandMCPOAuthLogoutResult;
  try {
    result = await mcp.oauthLogout(serverId);
  } catch {
    return { message: `Signing out of MCP server ${serverId} failed.`, success: false };
  }
  const signedOut = result.removed
    ? `Signed out of MCP server ${serverId}`
    : `MCP server ${serverId} was not signed in`;
  return {
    message: `${signedOut}; ${revocationText(result)}.`,
    success: true,
    data: { ...result },
  };
}
