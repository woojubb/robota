// PROVIDER-008: Provider-related MCP tool handlers.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ILocalMcpServerContext } from '../context.js';
import { makeErrorResult, makeTextResult } from '../utils.js';
import { listAvailableProviders, resolveProvider } from '../../providers/index.js';

export async function handleDagProviderList(ctx: ILocalMcpServerContext): Promise<CallToolResult> {
  const active = ctx.getActiveProvider();
  return makeTextResult({
    providers: listAvailableProviders(),
    active,
  });
}

export async function handleDagProviderSet(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const providerId = args['providerId'];
  if (typeof providerId !== 'string' || providerId.trim().length === 0) {
    return makeErrorResult('"providerId" is required');
  }
  ctx.setActiveProvider({ providerId });
  return makeTextResult({ ok: true, active: ctx.getActiveProvider() });
}

export async function handleDagProviderNodes(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const requested = args['providerId'];
  const active = ctx.getActiveProvider();
  const providerId =
    typeof requested === 'string' && requested.length > 0 ? requested : active.providerId;
  const provider = await resolveProvider({ provider: providerId });
  const nodes = await provider.listNodes();
  return makeTextResult({
    providerId: provider.providerId,
    count: nodes.length,
    nodes,
  });
}

export async function handleDagProviderRefresh(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const active = ctx.getActiveProvider();
  const providerId =
    typeof args['providerId'] === 'string' ? (args['providerId'] as string) : active.providerId;
  // The local in-process provider builds its catalog on demand; refresh is a no-op.
  return makeTextResult({
    ok: true,
    providerId,
    note: 'Refresh is a no-op for the local provider.',
  });
}
