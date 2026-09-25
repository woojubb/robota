import type {
  ICommandHostAdapterAccess,
  ICommandMCPActivationAdapter,
  ICommandMCPActivationSummary,
  ICommandMCPSourceProblem,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

function adapter(context: ICommandHostAdapterAccess): ICommandMCPActivationAdapter | undefined {
  return context.getCommandHostAdapters?.().mcpActivation;
}

function formatSummary(summary: ICommandMCPActivationSummary): string {
  const label = summary.displayName ? ` (${summary.displayName})` : '';
  return `  ${summary.serverId}${label} — ${summary.status} — ${summary.source} — ${summary.reason}`;
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

function listResult(mcp: ICommandMCPActivationAdapter | undefined): ICommandResult {
  if (!mcp) {
    return {
      message: 'MCP activation management is not available in this environment.',
      success: true,
    };
  }
  const entries = mcp.list();
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
      `MCP activation status:\n${entries.map(formatSummary).join('\n')}`,
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
      })),
      sourceProblems,
    },
  };
}

export async function executeMCPActivationCommand(
  context: ICommandHostAdapterAccess,
  args: string,
): Promise<ICommandResult> {
  const trimmed = args.trim();
  const spaceAt = trimmed.indexOf(' ');
  const verb = (spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt)).toLowerCase();
  const serverId = spaceAt === -1 ? '' : trimmed.slice(spaceAt + 1).trim();

  if (verb === '' || verb === 'status' || verb === 'list') {
    return listResult(adapter(context));
  }

  if (verb !== 'approve' && verb !== 'reject' && verb !== 'revoke') {
    return {
      message: 'Unknown argument. Usage: /mcp [status|approve|reject|revoke] [serverId]',
      success: false,
    };
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
