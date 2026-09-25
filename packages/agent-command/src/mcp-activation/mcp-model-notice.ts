/**
 * What the MODEL is told about an MCP server it cannot use, and which user command fixes it.
 *
 * Fixed words only. A server's name comes from a definition a repository may write, so it is named
 * only when it is safe to paste into any shell; otherwise the notice stays generic and points at
 * `/mcp status`, where the user sees the name. Nothing a server or its definition returned — reason
 * text, endpoint, header or token — ever reaches these strings.
 *
 * The actions themselves (approving a server, signing in, trusting a workspace) are the user's: the
 * model can only suggest the command.
 */

import { shellArgumentForDisplay } from '@robota-sdk/agent-core';

/** Why a server's tools are unavailable, as a user action that would fix it. */
export type TMCPUserAction = 'approve' | 'sign-in' | 'trust-workspace';

/** The command the user runs for `action`; `<server>` stands for a name that cannot be shown. */
export function mcpUserActionCommand(serverId: string, action: TMCPUserAction): string {
  const name = shellArgumentForDisplay(serverId) ?? '<server>';
  switch (action) {
    case 'approve':
      return `/mcp approve ${name}`;
    case 'sign-in':
      return `/mcp login ${name}`;
    case 'trust-workspace':
      return 'robota trust';
  }
}

const NEED: Record<TMCPUserAction, string> = {
  approve: 'is waiting for the user’s approval',
  'sign-in': 'needs the user to sign in',
  'trust-workspace': 'needs the user to trust this workspace',
};

function subject(serverId: string): string {
  const name = shellArgumentForDisplay(serverId);
  return name === undefined
    ? 'An MCP server (its name cannot be shown here; `/mcp status` lists it)'
    : `MCP server "${name}"`;
}

/** One server's notice: what is missing and the exact command to suggest. */
export function mcpUserActionNotice(serverId: string, action: TMCPUserAction): string {
  const where = action === 'trust-workspace' ? ' in a terminal, then restart the session' : '';
  return (
    `${subject(serverId)} ${NEED[action]}, so its tools are unavailable. You cannot do this ` +
    `yourself; ask the user to run \`${mcpUserActionCommand(serverId, action)}\`${where}.`
  );
}

/**
 * The notice for every server that could not start for a reason the user can fix, or `undefined`
 * when there is none. Meant for the model's context at session start.
 */
export function mcpUnavailableServersNotice(
  servers: ReadonlyMap<string, TMCPUserAction>,
): string | undefined {
  if (servers.size === 0) return undefined;
  const lines = [...servers].map(
    ([serverId, action]) => `- ${mcpUserActionNotice(serverId, action)}`,
  );
  return [
    'MCP servers that did not start this session. Mention this only when the user needs one of ' +
      'these servers or its tools:',
    ...lines,
  ].join('\n');
}
