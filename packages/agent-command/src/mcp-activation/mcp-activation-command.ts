import { shellArgumentForDisplay } from '@robota-sdk/agent-core';

import { mcpModelStatusResult } from './mcp-model-status.js';

import type {
  ICommandHostAdapterAccess,
  ICommandHostSessionAccess,
  ICommandHostUserInteraction,
  ICommandHostWorkspace,
  ICommandMCPActivationAdapter,
  ICommandMCPActivationSummary,
  ICommandMCPOAuthLoginRequest,
  ICommandMCPOAuthLoginResult,
  ICommandMCPOAuthLogoutResult,
  ICommandMCPOAuthStatus,
  ICommandMCPSourceProblem,
} from '@robota-sdk/agent-framework';
import type { ICommandProductVocabulary } from '@robota-sdk/agent-framework';
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
  'Usage: /mcp [status] | /mcp <approve|reject|revoke|logout> <serverId> | /mcp login <serverId> [--no-browser] | /mcp reload';
const LOGIN_USAGE = 'Usage: /mcp login <serverId> [--no-browser]';

/**
 * A server's name as a command argument. It comes from a definition a repository may write, so it
 * is shown only when it is safe to paste into any shell; otherwise `<server>` stands in for it.
 */
function serverArgument(serverId: string): string {
  return shellArgumentForDisplay(serverId) ?? '<server>';
}

/** How to sign in to one server: in this session, or from a terminal. */
function signInHint(serverId: string, cliName?: string): string {
  const argument = serverArgument(serverId);
  const terminal =
    cliName === undefined
      ? 'sign in from a terminal'
      : `run ${cliName} mcp login ${argument} in a terminal`;
  const how = `run /mcp login ${argument}, or ${terminal}`;
  return shellArgumentForDisplay(serverId) === undefined
    ? ` (${how}; its name cannot be shown safely here)`
    : ` (${how})`;
}

function formatSummary(
  summary: ICommandMCPActivationSummary,
  oauth: ICommandMCPOAuthStatus['state'] | undefined,
  cliName?: string,
): string {
  const label = summary.displayName ? ` (${summary.displayName})` : '';
  // A fixed word per state: nothing token-derived ever reaches this line.
  const signIn =
    oauth === undefined
      ? ''
      : ` — OAuth: ${OAUTH_STATE_LABEL[oauth]}${oauth === 'sign-in-required' || oauth === 'signed-out' ? signInHint(summary.serverId, cliName) : ''}`;
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

async function listResult(
  mcp: ICommandMCPActivationAdapter | undefined,
  cliName?: string,
): Promise<ICommandResult> {
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
        .map((entry) => formatSummary(entry, oauth.get(entry.serverId), cliName))
        .join('\n')}`,
      ...sourceProblemLines,
    ].join('\n\n'),
    success: true,
    data: {
      servers: entries.map((entry) => ({
        serverId: entry.serverId,
        ...(entry.displayName === undefined ? {} : { displayName: entry.displayName }),
        source: entry.source,
        status: entry.status,
        allowed: entry.allowed,
        provenanceId: entry.provenanceId,
        definitionFingerprint: entry.definitionFingerprint,
        securityIdentity: entry.securityIdentity,
        ...(oauth.has(entry.serverId) ? { oauth: oauth.get(entry.serverId) } : {}),
        // #3282 §4 part b-2: the Settings screen's MCP Servers section.
        ...(entry.connection === undefined ? {} : { connection: entry.connection }),
        ...(entry.connectionFailureReason === undefined
          ? {}
          : { connectionFailureReason: entry.connectionFailureReason }),
        ...(entry.toolNames === undefined ? {} : { toolNames: entry.toolNames }),
      })),
      sourceProblems,
    },
  };
}

/** What `/mcp` reaches: its port, and — to sign in — the live session and the user. */
export type TMCPActivationCommandContext = ICommandHostAdapterAccess &
  Pick<ICommandHostSessionAccess, 'getSession'> &
  ICommandHostUserInteraction &
  Partial<Pick<ICommandHostWorkspace, 'getCommandInvocationSource'>> & {
    getCommandSurfaceLocalityEvidence?(): 'local' | 'remote' | undefined;
    getCommandProductVocabulary?(): ICommandProductVocabulary | undefined;
  };

export async function executeMCPActivationCommand(
  context: TMCPActivationCommandContext,
  args: string,
): Promise<ICommandResult> {
  const trimmed = args.trim();
  const spaceAt = trimmed.indexOf(' ');
  const cliName = context.getCommandProductVocabulary?.()?.cliName;
  const verb = (spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt)).toLowerCase();
  const serverId = spaceAt === -1 ? '' : trimmed.slice(spaceAt + 1).trim();

  if (verb.startsWith('skill-')) return skillResult(context, verb, serverId);

  if (verb === '' || verb === 'status' || verb === 'list') {
    // The full view only for a caller known to be a person; an unknown caller gets the model's view.
    const source = context.getCommandInvocationSource?.();
    return source === 'user' || source === 'remote'
      ? listResult(adapter(context), cliName)
      : mcpModelStatusResult(adapter(context), cliName);
  }
  if (verb === 'login') return loginResult(context, serverId);
  if (verb === 'reload') return reloadResult(context);

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
    const decided = {
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
    // An approval takes effect now: the session connects the server as `/mcp reload` would.
    if (verb !== 'approve' || result.status !== 'approved' || mcp.reload === undefined) {
      return decided;
    }
    try {
      const reloaded = await reloadResult(context);
      return {
        ...decided,
        message: `${decided.message} ${reloaded.message}`,
        data: { ...decided.data, reload: reloaded.data ?? {} },
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ...decided,
        message: `${decided.message} Could not connect now: ${reason}. Run /mcp reload to retry.`,
      };
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      success: false,
    };
  }
}

/** JSON arrays preserve opaque identities; ordinary whitespace-separated arguments remain convenient. */
function skillArguments(args: string): string[] | undefined {
  if (!args.startsWith('[')) return args.split(/\s+/).filter(Boolean);
  try {
    const parsed: unknown = JSON.parse(args);
    return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

async function skillResult(
  context: TMCPActivationCommandContext,
  verb: string,
  rest: string,
): Promise<ICommandResult> {
  const source = context.getCommandInvocationSource?.();
  const localUser =
    source === 'user' ||
    (source === 'remote' && context.getCommandSurfaceLocalityEvidence?.() === 'local');
  if (verb !== 'skill-list' && !localUser)
    return {
      success: false,
      message: 'Only a known local user can inspect, approve or withdraw MCP skill instructions.',
    };
  const words = skillArguments(rest);
  const count = verb === 'skill-list' ? 1 : verb === 'skill-approve' ? 3 : 2;
  if (
    !['skill-list', 'skill-inspect', 'skill-approve', 'skill-withdraw'].includes(verb) ||
    !words ||
    words.length !== count ||
    words.some((word) => word.length === 0)
  )
    return {
      success: false,
      message:
        'Usage: /mcp skill-list <server> | skill-inspect <server> <uri> | skill-approve <server> <uri> <fingerprint> | skill-withdraw <server> <uri>. JSON string arrays also accept opaque arguments.',
    };
  const skills = adapter(context)?.skills;
  if (!skills)
    return { success: false, message: 'MCP Skills are not available in this environment.' };
  const serverId = words[0]!;
  const uri = words[1]!;
  try {
    if (verb === 'skill-list') {
      const entries = await skills.list(serverId);
      return {
        success: true,
        message:
          entries.length === 0
            ? 'No MCP skills are advertised.'
            : entries
                .map(
                  (entry) =>
                    `${entry.name} — ${entry.uri}\n${entry.description}` +
                    (entry.invocationName ? `\nInvoke skill: ${entry.invocationName}` : '') +
                    (entry.unavailableReason ? `\nUnavailable: ${entry.unavailableReason}` : ''),
                )
                .join('\n\n'),
        data: {
          skills: entries.map((entry) => ({
            serverId: entry.serverId,
            uri: entry.uri,
            name: entry.name,
            description: entry.description,
            ...(entry.invocationName ? { invocationName: entry.invocationName } : {}),
            ...(entry.unavailableReason ? { unavailableReason: entry.unavailableReason } : {}),
          })),
        },
      };
    }
    if (verb === 'skill-withdraw') {
      skills.withdraw(serverId, uri, 'user');
      return { success: true, message: 'MCP skill content consent withdrawn.' };
    }
    const preview =
      verb === 'skill-approve'
        ? await skills.approve(serverId, uri, words[2]!, 'user')
        : await skills.inspect(serverId, uri);
    const args = [serverId, uri, preview.fingerprint];
    const approveArgs = args.every((arg) => /^[\w:./%-]+$/.test(arg))
      ? args.join(' ')
      : JSON.stringify(args);
    return {
      success: true,
      message:
        verb === 'skill-approve'
          ? 'MCP skill content consent saved; activation remains a separate action.'
          : `${preview.content}\n\nFrontmatter: ${JSON.stringify(preview.frontmatter)}\n\nApprove exactly this content: /mcp skill-approve ${approveArgs}`,
      data: {
        serverId: preview.serverId,
        uri: preview.uri,
        namespace: preview.namespace,
        fingerprint: preview.fingerprint,
        frontmatter: preview.frontmatter,
        ...(verb === 'skill-inspect' ? { content: preview.content } : {}),
      },
    };
  } catch {
    return {
      success: false,
      message:
        'MCP skill request refused. Check /mcp status; run /mcp skill-inspect <server> <uri> before granting content consent.',
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

/**
 * #3282 §4 part b-2: `/mcp reload` and the Settings screen's "Reload servers" button — retries
 * every server not currently connected and adds whatever tools it now offers to the live session,
 * the same way a completed sign-in does.
 */
async function reloadResult(context: TMCPActivationCommandContext): Promise<ICommandResult> {
  const mcp = adapter(context);
  if (!mcp) {
    return {
      message: 'MCP activation management is not available in this environment.',
      success: true,
    };
  }
  if (mcp.reload === undefined) {
    return {
      message: 'Reloading MCP servers is not available in this environment.',
      success: false,
    };
  }
  const result = await mcp.reload();
  let added: readonly string[] = [];
  try {
    added = result.tools.length === 0 ? [] : await context.getSession().addTools(result.tools);
  } finally {
    if (result.reloadToken !== undefined) mcp.reloadToolsAdded?.(result.reloadToken, added);
  }
  const dropped = result.tools.length - added.length;
  const parts = [
    result.connectedServerIds.length === 0
      ? 'No server newly connected.'
      : `Connected: ${result.connectedServerIds.join(', ')}.`,
    result.failedServerIds.length === 0
      ? undefined
      : `Still not connected: ${result.failedServerIds.join(', ')} (see /mcp status).`,
    dropped === 0
      ? undefined
      : `${dropped} of the new tools ${dropped === 1 ? 'was' : 'were'} left out: the session already has a tool by that name.`,
  ].filter((part): part is string => part !== undefined);
  return {
    message: `Reloaded MCP servers. ${parts.join(' ')}`.trim(),
    success: true,
    data: {
      connectedServerIds: result.connectedServerIds,
      failedServerIds: result.failedServerIds,
      tools: [...added],
    },
  };
}

let loginPrompts = 0;

/** Before the browser opens: the URL it will show, and the choice to paste or cancel instead. */
function browserConfirmer(
  context: ICommandHostUserInteraction,
  serverId: string,
): ICommandMCPOAuthLoginRequest['confirmBrowser'] {
  const ui = context.getUserInteraction();
  if (ui === undefined) return undefined;
  return async (prompt, signal) => {
    // The ask port cannot withdraw a question, so a sign-in that has already ended is not asked
    // about, and an answer that arrives after it ended never opens a browser for it.
    if (signal.aborted) return 'cancel';
    loginPrompts += 1;
    const answer = await ui.ask({
      id: `mcp-login-browser-${loginPrompts}`,
      title: `Sign in to MCP server ${serverArgument(serverId)}`,
      description:
        `Your browser will open this URL; if it does not, open it yourself:\n${prompt.authorizationUrl}\n\n` +
        'The sign-in completes on its own once you approve in the browser.',
      options: [
        { value: 'open', label: 'Open my browser' },
        { value: 'paste', label: 'Paste the redirect instead (browser on another machine)' },
        { value: 'cancel', label: 'Cancel' },
      ],
      maxSelect: 1,
      default: { values: ['open'] },
    });
    if (answer.type !== 'answer' || signal.aborted) return 'cancel';
    const choice = answer.values[0];
    return choice === 'open' || choice === 'paste' ? choice : 'cancel';
  };
}

/** Asks, through the session's own prompt, for the redirect URL the user's browser was sent to. */
function redirectReader(
  context: ICommandHostUserInteraction,
  serverId: string,
): ICommandMCPOAuthLoginRequest['readRedirect'] {
  const ui = context.getUserInteraction();
  if (ui === undefined) return undefined;
  return async (prompt, signal) => {
    // A sign-in that has already ended (cancelled or timed out) does not ask for a paste.
    signal.throwIfAborted();
    loginPrompts += 1;
    const answer = await ui.ask({
      id: `mcp-login-redirect-${loginPrompts}`,
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
function loginFailureText(result: ICommandMCPOAuthLoginResult, cliName?: string): string {
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
      if (cliName === undefined) {
        return 'Signing in without a browser needs a redirect URL pasted in a terminal, but no product command name is available in this session.';
      }
      return (
        'Signing in without a browser needs the redirect URL pasted here, and nothing here can ask ' +
        `for it; run ${cliName} mcp login ${argument} --no-browser in a terminal.`
      );
    case 'browser-failed':
      return (
        `Sign-in to MCP server ${serverId} failed (browser-failed): no browser could be opened. ` +
        `Run /mcp login ${argument} --no-browser to paste the redirect instead.`
      );
    default: {
      const secret =
        failure === 'token-exchange-failed' && result.preRegisteredClient
          ? cliName === undefined
            ? ' If its pre-registered client needs a secret, sign in from a terminal configured for this product.'
            : ` If its pre-registered client needs a secret, run ${cliName} mcp login ${argument} --client-secret in a terminal.`
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
        : `Signed in to MCP server ${serverId}; ${added} of its tools ${added === 1 ? 'is' : 'are'} available from your next message.`;
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
  const cliName = context.getCommandProductVocabulary?.()?.cliName;
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
        cliName === undefined
          ? 'A client secret is never typed into a session. Sign in from a terminal configured for this product.'
          : `A client secret is never typed into a session. Run ${cliName} mcp login ${argument} --client-secret in a terminal.`,
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
      message:
        cliName === undefined
          ? 'Signing in is not available in this session; sign in from a terminal configured for this product.'
          : `Signing in is not available in this session; run ${cliName} mcp login ${argument} in a terminal.`,
      success: false,
    };
  }
  // A dismissed prompt cancels the sign-in itself, not only the read it was for.
  const cancel = new AbortController();
  const readRedirect = redirectReader(context, serverId);
  const confirmBrowser = noBrowser ? undefined : browserConfirmer(context, serverId);
  const result = await mcp.oauthLogin({
    serverId,
    noBrowser,
    signal: cancel.signal,
    ...(readRedirect === undefined
      ? {}
      : {
          readRedirect: (prompt, signal) =>
            readRedirect(prompt, signal).catch((error: unknown) => {
              cancel.abort();
              throw error;
            }),
        }),
    ...(confirmBrowser === undefined
      ? {}
      : {
          confirmBrowser: async (prompt, signal) => {
            const choice = await confirmBrowser(prompt, signal);
            if (choice === 'cancel') cancel.abort();
            return choice;
          },
        }),
  });
  if (result.failure !== undefined) {
    return {
      message: loginFailureText(result, cliName),
      success: false,
      data: { serverId, failure: result.failure },
    };
  }
  const added = result.tools.length === 0 ? [] : await context.getSession().addTools(result.tools);
  if (result.tools.length > 0) mcp.oauthToolsAdded?.(serverId, added);
  const dropped = result.tools.length - added.length;
  const droppedText =
    dropped === 0
      ? ''
      : ` ${dropped} of its tools ${dropped === 1 ? 'was' : 'were'} left out: the session already has a tool by that name.`;
  return {
    message: `${loginSuccessText(serverId, result.connection, added.length)}${droppedText}`,
    success: true,
    data: {
      serverId,
      connection: result.connection ?? 'not-connected',
      tools: [...added],
      ...(dropped === 0 ? {} : { dropped }),
    },
  };
}
