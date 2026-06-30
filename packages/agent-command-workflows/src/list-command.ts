import { LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';

import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

/**
 * `/workflows list` — list the workflow nodes available to the in-process DAG runtime.
 * Composes `dag-framework`'s local provider; no dependency on the `dag-cli` product.
 */
export async function executeWorkflowsList(): Promise<ICommandResult> {
  const provider = new LocalDagRuntimeProvider();
  const nodes = await provider.listNodes();
  const sorted = [...nodes].sort((a, b) => a.nodeType.localeCompare(b.nodeType));
  const lines = sorted.map((n) => `  ${n.nodeType}${n.description ? ` — ${n.description}` : ''}`);
  return {
    success: true,
    message: `Available workflow nodes (${nodes.length}):\n${lines.join('\n')}`,
  };
}
