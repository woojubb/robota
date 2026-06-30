/** Handlers for node-related MCP tools: dag_nodes_list, dag_node_packages_list, dag_nodes_info */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { discoverExternalNodePackages } from '../../marketplace/external-node-scanner.js';
import type { ILocalMcpServerContext } from '../context.js';
import { makeTextResult, makeErrorResult } from '../utils.js';

export async function handleDagNodesList(ctx: ILocalMcpServerContext): Promise<CallToolResult> {
  const manifests = ctx.getManifests();
  return makeTextResult({
    nodes: manifests.map((m) => ({
      nodeType: m.nodeType,
      displayName: m.displayName,
      category: m.category,
    })),
  });
}

export async function handleDagNodePackagesList(
  _ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const rawRoots = args['searchRoots'];
  const searchRoots =
    Array.isArray(rawRoots) && rawRoots.every((r) => typeof r === 'string')
      ? (rawRoots as string[])
      : undefined;
  const packages = await discoverExternalNodePackages(searchRoots);
  return makeTextResult({
    packages: packages.map((p) => ({
      name: p.name,
      version: p.version,
      description: p.description,
      nodes: p.nodeManifest.nodes.map((n) => ({
        nodeType: n.nodeType,
        displayName: n.displayName,
        category: n.category,
      })),
    })),
    totalPackages: packages.length,
    totalNodes: packages.reduce((sum, p) => sum + p.nodeManifest.nodes.length, 0),
  });
}

export function handleDagNodesInfo(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): CallToolResult {
  const nodeType = args['nodeType'];
  if (typeof nodeType !== 'string' || nodeType.trim().length === 0) {
    return makeErrorResult('"nodeType" is required');
  }
  const manifests = ctx.getManifests();
  const manifest = manifests.find((m) => m.nodeType === nodeType);
  if (!manifest) {
    // Suggest similar node types
    const similar = manifests
      .map((m) => m.nodeType)
      .filter((t) => t.includes(nodeType) || nodeType.includes(t))
      .slice(0, 3);
    const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
    return makeErrorResult(`Unknown node type "${nodeType}".${suggestion}`);
  }
  return makeTextResult(manifest);
}
