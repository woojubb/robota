import { shellArgumentForDisplay } from '@robota-sdk/agent-core';

import type {
  ICommandHostAdapterAccess,
  ICommandHostSessionAccess,
  ICommandHostUserInteraction,
  ICommandMCPActivationAdapter,
  ICommandMCPActivationSummary,
  ICommandMCPOAuthLoginRequest,
  ICommandMCPOAuthLoginResult,
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

const USAGE =
  'Usage: /mcp [status] | /mcp <approve|reject|revoke|logout> <serverId> | /mcp login <serverId> [--no-browser]';
const LOGIN_USAGE = 'Usage: /mcp login <serverId> [--no-browser]';

/**
 * A server's name as a command argument. It comes from a definition a repository may write, so it
 * is shown only when it is safe to paste into any shell; otherwise `<server>` stands in for it.
 */
function serverArgument(serverId: string): string {
  return shellArgumentForDisplay(serverId) ?? '<server>';
}

/** How to sign in to one server: in this session, or from a terminal. */
function signInHint(serverId: string): string {
  const argument = serverArgument(serverId);
  const how = `run /mcp login ${argument}, or robota mcp login ${argument} in a terminal`;
  return shellArgumentForDisplay(serverId) === undefined
    ? ` (${how}; its name cannot be shown safely here)`
    : ` (${how})`;
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

/** What `/mcp` reaches: its port, and — to sign in — the live session and the user. */
export type TMCPActivationCommandContext = ICommandHostAdapterAccess &
  Pick<ICommandHostSessionAccess, 'getSession'> &
  ICommandHostUserInteraction;

export async function executeMCPActivationCommand(
  context: TMCPActivationCommandContext,
  args: string,
): Promise<ICommandResult> {
  const trimmed = args.trim();
  const spaceAt = trimmed.indexOf(' ');
  const verb = (spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt)).toLowerCase();
  const serverId = spaceAt === -1 ? '' : trimmed.slice(spaceAt + 1).trim();

  if (verb === '' || verb === 'status' || verb === 'list') {
    return listResult(adapter(context));
  }
  if (verb === 'login') return loginResult(context, serverId);

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

let redirectPrompts = 0;

/** Asks, through the session's own prompt, for the redirect URL the user's browser was sent to. */
function redirectReader(
  context: ICommandHostUserInteraction,
  serverId: string,
): ICommandMCPOAuthLoginRequest['readRedirect'] {
  const ui = context.getUserInteraction();
  if (ui === undefined) return undefined;
  return async (prompt) => {
    redirectPrompts += 1;
    const answer = await ui.ask({
      id: `mcp-login-redirect-${redirectPrompts}`,
      title: `Sign in to MCP server ${serverArgument(serverId)}`,
      description:
        `Open this URL in a browser:\n${prompt.authorizationUrl}\n\n` +
        `After you approve, the browser is sent to ${prompt.redirectUri}, which may not load. ` +
        'Copy the full address from its address bar and paste it here.',
      allowFreeText: true,
      masked: true,
      placeholder: 'Redirect URL (not shown)',
    });
    if (answer.type !== 'answer' || answer.text === undefined || answer.text.trim() === '') {
      throw new Error('No redirect URL was pasted.');
    }
    return answer.text;
  };
}

/** Why a sign-in did not complete, and what to run instead, by fixed words only. */
function loginFailureText(result: ICommandMCPOAuthLoginResult): string {
  const { serverId, failure } = result;
  const argument = serverArgument(serverId);
  switch (failure) {
    case 'not-oauth':
      return `MCP server ${serverId} does not declare OAuth; there is nothing to sign in to.`;
    case 'url-unset':
      return `MCP server ${serverId} has an unset variable in its url.`;
    case 'sign-in-in-progress':
      return `A sign-in to MCP server ${serverId} is already in progress.`;
    case 'prompt-unavailable':
      return (
        'Signing in without a browser needs the redirect URL pasted here, and nothing here can ask ' +
        `for it; run robota mcp login ${argument} --no-browser in a terminal.`
      );
    case 'browser-failed':
      return (
        `Sign-in to MCP server ${serverId} failed (browser-failed): no browser could be opened. ` +
        `Run /mcp login ${argument} --no-browser to paste the redirect instead.`
      );
    default: {
      const secret =
        failure === 'token-exchange-failed' && result.preRegisteredClient
          ? ` If its pre-registered client needs a secret, run robota mcp login ${argument} --client-secret in a terminal.`
          : '';
      return `Sign-in to MCP server ${serverId} failed (${failure ?? 'unexpected-error'}); nothing was changed.${secret}`;
    }
  }
}

/** What a completed sign-in did to this session. */
function loginSuccessText(
  serverId: string,
  connection: ICommandMCPOAuthLoginResult['connection'],
  added: number,
): string {
  switch (connection) {
    case 'connected':
      return added === 0
        ? `Signed in to MCP server ${serverId}; it is connected and offers no new tools.`
        : `Signed in to MCP server ${serverId}; ${added} of its tools ${added === 1 ? 'is' : 'are'} now available.`;
    case 'recovered':
      return `Signed in to MCP server ${serverId}; its tools work again.`;
    case 'not-admitted':
      return `Signed in to MCP server ${serverId}, but it is not approved for this session (see /mcp status).`;
    default:
      return `Signed in to MCP server ${serverId}, but it could not connect in this session; the next session connects it.`;
  }
}

async function loginResult(
  context: TMCPActivationCommandContext,
  rest: string,
): Promise<ICommandResult> {
  const words = rest.split(/\s+/).filter((word) => word !== '');
  const noBrowser = words.includes('--no-browser');
  const withSecret = words.includes('--client-secret');
  const positional = words.filter((word) => word !== '--no-browser' && word !== '--client-secret');
  const serverId = positional[0];
  if (positional.length !== 1 || serverId === undefined || serverId.startsWith('-')) {
    return { message: LOGIN_USAGE, success: false };
  }
  const argument = serverArgument(serverId);
  if (withSecret) {
    // A secret typed here would become part of the conversation; it is asked for only in a terminal.
    return {
      message:
        'A client secret is never typed into a session. Run robota mcp login ' +
        `${argument} --client-secret in a terminal.`,
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
  if (mcp.oauthLogin === undefined) {
    return {
      message: `Signing in is not available in this session; run robota mcp login ${argument} in a terminal.`,
      success: false,
    };
  }
  const readRedirect = redirectReader(context, serverId);
  const result = await mcp.oauthLogin({
    serverId,
    noBrowser,
    ...(readRedirect === undefined ? {} : { readRedirect }),
  });
  if (result.failure !== undefined) {
    return {
      message: loginFailureText(result),
      success: false,
      data: { serverId, failure: result.failure },
    };
  }
  const added = result.tools.length === 0 ? [] : await context.getSession().addTools(result.tools);
  return {
    message: loginSuccessText(serverId, result.connection, added.length),
    success: true,
    data: { serverId, connection: result.connection ?? 'not-connected', tools: [...added] },
  };
}
