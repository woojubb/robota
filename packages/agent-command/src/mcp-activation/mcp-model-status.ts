/**
 * `/mcp status` as the MODEL receives it: names, states and the user command that would fix a
 * server — nothing else.
 *
 * The user's view carries each definition's reason text, source, provenance, fingerprint and
 * security identity. None of that helps the model decide what to suggest, and some of it is
 * definition-derived text a repository wrote, so the model's view is rebuilt from fixed words
 * rather than filtered from the user's. A name that is not safe to show is replaced, never quoted.
 */

import { shellArgumentForDisplay } from '@robota-sdk/agent-core';

import { mcpUserActionCommand } from './mcp-model-notice.js';

import type { TMCPUserAction } from './mcp-model-notice.js';
import type {
  ICommandMCPActivationAdapter,
  ICommandMCPActivationSummary,
  ICommandMCPOAuthStatus,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

type TOAuthState = ICommandMCPOAuthStatus['state'];

function userActionFor(
  status: ICommandMCPActivationSummary['status'],
  oauth: TOAuthState | undefined,
): TMCPUserAction | undefined {
  if (status === 'pending' || status === 'stale') return 'approve';
  if (status === 'untrusted') return 'trust-workspace';
  if (status === 'approved' && (oauth === 'sign-in-required' || oauth === 'signed-out')) {
    return 'sign-in';
  }
  // `rejected` and `revoked` are decisions the user already made; there is nothing to suggest.
  return undefined;
}

interface IModelServerView {
  readonly name?: string;
  readonly status: ICommandMCPActivationSummary['status'];
  readonly oauth?: TOAuthState;
  readonly suggestCommand?: string;
}

function toModelView(
  summary: ICommandMCPActivationSummary,
  oauth: TOAuthState | undefined,
): IModelServerView {
  const name = shellArgumentForDisplay(summary.serverId);
  const action = userActionFor(summary.status, oauth);
  return {
    ...(name === undefined ? {} : { name }),
    status: summary.status,
    ...(oauth === undefined ? {} : { oauth }),
    ...(action === undefined
      ? {}
      : { suggestCommand: mcpUserActionCommand(summary.serverId, action) }),
  };
}

function formatLine(view: IModelServerView): string {
  const name = view.name ?? '(name not shown)';
  const signIn = view.oauth === undefined ? '' : ` — sign-in: ${view.oauth}`;
  const suggest =
    view.suggestCommand === undefined ? '' : ` — ask the user to run \`${view.suggestCommand}\``;
  return `  ${name} — ${view.status}${signIn}${suggest}`;
}

export async function mcpModelStatusResult(
  mcp: ICommandMCPActivationAdapter | undefined,
): Promise<ICommandResult> {
  if (!mcp) {
    return { message: 'MCP is not available in this environment.', success: true };
  }
  const oauthStates = new Map(
    ((await mcp.oauthStatus?.()) ?? []).map((status) => [status.serverId, status.state]),
  );
  const servers = mcp
    .list()
    .map((summary) => toModelView(summary, oauthStates.get(summary.serverId)));
  const unreadableSources = (mcp.sourceProblems?.() ?? []).length;
  const lines =
    servers.length === 0
      ? ['No MCP servers are configured.']
      : ['MCP servers:', ...servers.map(formatLine)];
  if (unreadableSources > 0) {
    lines.push(
      `${unreadableSources} MCP configuration source(s) could not be read; the user can see which with \`/mcp status\`.`,
    );
  }
  return {
    message: lines.join('\n'),
    success: true,
    data: { servers, unreadableSources },
  };
}
