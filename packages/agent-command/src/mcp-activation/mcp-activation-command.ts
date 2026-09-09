import type {
  ICommandHostAdapterAccess,
  ICommandMCPActivationAdapter,
  ICommandMCPActivationSummary,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

function adapter(context: ICommandHostAdapterAccess): ICommandMCPActivationAdapter | undefined {
  return context.getCommandHostAdapters?.().mcpActivation;
}

function formatSummary(summary: ICommandMCPActivationSummary): string {
  const label = summary.displayName ? ` (${summary.displayName})` : '';
  return `  ${summary.serverId}${label} — ${summary.status} — ${summary.source} — ${summary.reason}`;
}

function listResult(mcp: ICommandMCPActivationAdapter | undefined): ICommandResult {
  if (!mcp) {
    return {
      message: 'MCP activation management is not available in this environment.',
      success: true,
    };
  }
  const entries = mcp.list();
  if (entries.length === 0) {
    return { message: 'No MCP definitions are registered.', success: true, data: { servers: [] } };
  }
  return {
    message: `MCP activation status:\n${entries.map(formatSummary).join('\n')}`,
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
      success: result.status === 'approved' || result.status === 'rejected' || result.status === 'revoked',
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
