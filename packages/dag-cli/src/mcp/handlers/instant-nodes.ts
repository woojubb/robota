/** Handlers for instant-node MCP tools: dag_instant_node_create, dag_instant_node_create_composite, dag_instant_node_list */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { IDagNodeDefinition } from '@robota-sdk/dag-core';
import {
  createPromptBackedNodeDefinition,
  createCompositeInstantNodeDefinition,
  type ICreatePromptNodeInput,
  type ICreateCompositeNodeInput,
  type TInstantNodeProvider,
} from '@robota-sdk/dag-node-instant-node';
import { saveNode, loadNodes, buildCompositeRunner } from '../../local-runner/persistence/store.js';
import { nodesDir, NODE_MANIFEST_EXT } from '../../local-runner/persistence/paths.js';
import type { ILocalMcpServerContext } from '../context.js';
import { makeTextResult, makeErrorResult } from '../utils.js';

/** Re-exported for the server context startup loader. */
export { loadNodes as loadSavedInstantNodes };

function projectDirOf(ctx: ILocalMcpServerContext): string {
  return ctx.options.projectDir ?? process.cwd();
}

export async function handleDagInstantNodeCreate(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
  sessionGate: import('../../session/session-gate.js').SessionPermissionGate | undefined,
): Promise<CallToolResult> {
  if (sessionGate) {
    const expiry = sessionGate.checkExpiry();
    if (expiry) return makeTextResult({ ok: false, error: expiry }, true);
    const violation = sessionGate.checkInstantNodeCreation();
    if (violation) return makeTextResult({ ok: false, error: violation }, true);
  }

  const nodeType = args['nodeType'];
  const displayName = args['displayName'];
  const systemPromptTemplate = args['systemPromptTemplate'];
  const inputPorts = args['inputPorts'];
  const outputPort = args['outputPort'];

  if (typeof nodeType !== 'string' || nodeType.trim().length === 0) {
    return makeErrorResult('"nodeType" is required');
  }
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    return makeErrorResult('"displayName" is required');
  }
  if (typeof systemPromptTemplate !== 'string' || systemPromptTemplate.trim().length === 0) {
    return makeErrorResult('"systemPromptTemplate" is required');
  }
  if (
    !Array.isArray(inputPorts) ||
    inputPorts.length === 0 ||
    !inputPorts.every((p) => typeof p === 'object' && p !== null && typeof p.key === 'string')
  ) {
    return makeErrorResult('"inputPorts" must be a non-empty array of {key: string} objects');
  }
  if (
    typeof outputPort !== 'object' ||
    outputPort === null ||
    typeof (outputPort as Record<string, unknown>).key !== 'string'
  ) {
    return makeErrorResult('"outputPort" must be an object with a "key" string property');
  }

  const existingIndex = ctx.instantNodeDefinitions.findIndex((n) => n.nodeType === nodeType.trim());
  if (existingIndex !== -1) {
    return makeErrorResult(
      `Node type "${nodeType.trim()}" is already registered as an instant node. Use a different nodeType or call dag_instant_node_delete first.`,
    );
  }

  const rawProvider = args['provider'];
  const validProviders: TInstantNodeProvider[] = [
    'anthropic',
    'openai',
    'gemini',
    'deepseek',
    'qwen',
  ];
  const provider: TInstantNodeProvider | undefined =
    typeof rawProvider === 'string' && validProviders.includes(rawProvider as TInstantNodeProvider)
      ? (rawProvider as TInstantNodeProvider)
      : undefined;

  const spec: ICreatePromptNodeInput = {
    nodeType: nodeType.trim(),
    displayName: displayName.trim(),
    systemPromptTemplate: systemPromptTemplate.trim(),
    inputPorts: (inputPorts as Array<{ key: string; description?: string }>).map((p) => ({
      key: p.key,
      description: typeof p.description === 'string' ? p.description : undefined,
    })),
    outputPort: {
      key: (outputPort as { key: string; description?: string }).key,
      description:
        typeof (outputPort as Record<string, unknown>).description === 'string'
          ? ((outputPort as Record<string, unknown>).description as string)
          : undefined,
    },
    provider,
    model: typeof args['model'] === 'string' ? args['model'] : undefined,
  };

  const nodeDef = createPromptBackedNodeDefinition(spec);
  ctx.invalidateNodeCache();
  ctx.instantNodeDefinitions.push(nodeDef);
  await saveNode(nodeDef, projectDirOf(ctx));

  const manifests = ctx.getManifests();
  const manifest = manifests.find((m) => m.nodeType === spec.nodeType);
  return makeTextResult({
    ok: true,
    nodeType: spec.nodeType,
    manifest,
    instantNodeCount: ctx.instantNodeDefinitions.length,
  });
}

export async function handleDagInstantNodeCreateComposite(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
  sessionGate: import('../../session/session-gate.js').SessionPermissionGate | undefined,
): Promise<CallToolResult> {
  if (sessionGate) {
    const expiry = sessionGate.checkExpiry();
    if (expiry) return makeTextResult({ ok: false, error: expiry }, true);
    const violation = sessionGate.checkInstantNodeCreation();
    if (violation) return makeTextResult({ ok: false, error: violation }, true);
  }

  const nodeType = args['nodeType'];
  const displayName = args['displayName'];
  const innerDag = args['innerDag'];
  const exposedInputPort = args['exposedInputPort'];
  const exposedOutputPorts = args['exposedOutputPorts'];

  if (typeof nodeType !== 'string' || nodeType.trim().length === 0) {
    return makeErrorResult('"nodeType" is required');
  }
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    return makeErrorResult('"displayName" is required');
  }
  if (typeof innerDag !== 'object' || innerDag === null) {
    return makeErrorResult('"innerDag" must be a DAG definition object');
  }
  if (
    typeof exposedInputPort !== 'object' ||
    exposedInputPort === null ||
    typeof (exposedInputPort as Record<string, unknown>).key !== 'string'
  ) {
    return makeErrorResult('"exposedInputPort" must be an object with "key" and "mapsTo"');
  }
  if (!Array.isArray(exposedOutputPorts) || exposedOutputPorts.length === 0) {
    return makeErrorResult('"exposedOutputPorts" must be a non-empty array');
  }

  const existing = ctx.instantNodeDefinitions.findIndex((n) => n.nodeType === nodeType.trim());
  if (existing !== -1) {
    return makeErrorResult(
      `Node type "${nodeType.trim()}" is already registered. Use a different nodeType.`,
    );
  }

  const runner = buildCompositeRunner(ctx.instantNodeDefinitions);

  const spec: ICreateCompositeNodeInput = {
    nodeType: nodeType.trim(),
    displayName: displayName.trim(),
    innerDag: innerDag as import('@robota-sdk/dag-core').IDagDefinition,
    exposedInputPort: exposedInputPort as ICreateCompositeNodeInput['exposedInputPort'],
    exposedOutputPorts: exposedOutputPorts as ICreateCompositeNodeInput['exposedOutputPorts'],
    runner,
  };

  const nodeDef = createCompositeInstantNodeDefinition(spec);
  ctx.invalidateNodeCache();
  ctx.instantNodeDefinitions.push(nodeDef);
  await saveNode(nodeDef, projectDirOf(ctx));

  const manifests = ctx.getManifests();
  const manifest = manifests.find((m) => m.nodeType === spec.nodeType);
  return makeTextResult({
    ok: true,
    nodeType: spec.nodeType,
    manifest,
    instantNodeCount: ctx.instantNodeDefinitions.length,
  });
}

export function handleDagInstantNodeList(ctx: ILocalMcpServerContext): CallToolResult {
  return makeTextResult({
    instantNodes: ctx.instantNodeDefinitions.map((n) => ({
      nodeType: n.nodeType,
      displayName: n.displayName,
      category: n.category,
      defaultInputPort: n.defaultInputPort,
      defaultOutputPort: n.defaultOutputPort,
      inputCount: n.inputs.length,
      outputCount: n.outputs.length,
    })),
  });
}

export async function handleInstantNodeSave(
  args: Record<string, unknown>,
  ctx: ILocalMcpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const nodeType = typeof args['nodeType'] === 'string' ? args['nodeType'].trim() : '';
  if (!nodeType) {
    return { content: [{ type: 'text', text: 'Error: nodeType is required.' }] };
  }
  const nodeDef = ctx.instantNodeDefinitions.find((n) => n.nodeType === nodeType);
  if (!nodeDef) {
    return {
      content: [{ type: 'text', text: `Error: instant node "${nodeType}" not found in memory.` }],
    };
  }
  await saveNode(nodeDef, projectDirOf(ctx));
  return {
    content: [
      {
        type: 'text',
        text: `Saved node "${nodeType}" to .dag/nodes/${nodeType}${NODE_MANIFEST_EXT}`,
      },
    ],
  };
}

export async function handleInstantNodeListSaved(
  _args: Record<string, unknown>,
  ctx: ILocalMcpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const dir = nodesDir(projectDirOf(ctx));
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    // allow-fallback: .dag/nodes/ may not exist yet; treat as empty
    return {
      content: [
        {
          type: 'text',
          text: 'No saved nodes found (.dag/nodes/ does not exist).',
        },
      ],
    };
  }
  const jsonFiles = files.filter((f) => f.endsWith(NODE_MANIFEST_EXT));
  if (jsonFiles.length === 0) {
    return { content: [{ type: 'text', text: 'No saved nodes found.' }] };
  }
  const items: string[] = [];
  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(dir, file), 'utf-8');
      const record = JSON.parse(content) as {
        nodeType: string;
        displayName: string;
        createdAt: string;
      };
      items.push(`  ${record.nodeType}: ${record.displayName} (saved: ${record.createdAt})`);
    } catch {
      // allow-fallback: individual unreadable file is skipped with a placeholder
      items.push(`  ${file}: (unreadable)`);
    }
  }
  return {
    content: [{ type: 'text', text: `Saved nodes (${jsonFiles.length}):\n${items.join('\n')}` }],
  };
}
