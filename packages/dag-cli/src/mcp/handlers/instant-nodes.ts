/** Handlers for instant-node MCP tools: dag_instant_node_create, dag_instant_node_create_composite, dag_instant_node_list */

import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { IDagNodeDefinition } from '@robota-sdk/dag-core';
import {
  createPromptBackedNodeDefinition,
  createCompositeInstantNodeDefinition,
  type ICreatePromptNodeInput,
  type ICreateCompositeNodeInput,
  type ICompositeSubRunner,
  type TInstantNodeProvider,
} from '@robota-sdk/dag-node-instant-node';
import { LocalDagRunner, createCliNodeRegistry } from '../../local-runner/index.js';
import type { ILocalMcpServerContext } from '../context.js';
import { makeTextResult, makeErrorResult, safeParseJson } from '../utils.js';

async function saveInstantNodeToDisk(
  nodeDef: IDagNodeDefinition,
  taskCode: string | null,
  ctx: ILocalMcpServerContext,
): Promise<void> {
  const nodesDir = join(ctx.options.projectDir ?? process.cwd(), '.dag', 'nodes');
  await mkdir(nodesDir, { recursive: true });
  const record = {
    nodeType: nodeDef.nodeType,
    displayName: nodeDef.displayName ?? nodeDef.nodeType,
    category: nodeDef.category ?? 'Instant',
    createdAt: new Date().toISOString(),
    inputs: nodeDef.inputs ?? [],
    outputs: nodeDef.outputs ?? [],
    taskCode: taskCode ?? null,
  };
  const filePath = join(nodesDir, `${nodeDef.nodeType}.instant-node.json`);
  await writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');
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
  await saveInstantNodeToDisk(nodeDef, systemPromptTemplate.trim(), ctx);

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

  const capturedInstantNodeDefinitions = ctx.instantNodeDefinitions;
  const runner: ICompositeSubRunner = {
    async run(dag, input) {
      const subRunner = new LocalDagRunner([
        ...createCliNodeRegistry(),
        ...capturedInstantNodeDefinitions,
      ]);
      try {
        // allow-fallback: inner DAG errors are returned as structured result
        const subResult = await subRunner.run(dag, input);
        const outputs: Record<string, import('@robota-sdk/dag-core').TPortPayload> = {};
        for (const tr of subResult.taskRuns) {
          if (tr.outputSnapshot) {
            const parsed = safeParseJson(tr.outputSnapshot);
            if (typeof parsed === 'object' && parsed !== null) {
              outputs[tr.nodeId] = parsed as import('@robota-sdk/dag-core').TPortPayload;
            }
          }
        }
        return { ok: subResult.dagRun.status === 'success', outputs };
      } catch (err) {
        // allow-fallback: inner DAG errors are returned as structured result
        return {
          ok: false,
          outputs: {},
          error: err instanceof Error ? err.message : 'Inner DAG run failed',
        };
      }
    },
  };

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
  await saveInstantNodeToDisk(nodeDef, null, ctx);

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
  await saveInstantNodeToDisk(nodeDef, null, ctx);
  return {
    content: [
      {
        type: 'text',
        text: `Saved instant node "${nodeType}" to .dag/nodes/${nodeType}.instant-node.json`,
      },
    ],
  };
}

/**
 * Load saved instant nodes from `.dag/nodes/*.instant-node.json` and reconstruct
 * them as IDagNodeDefinition using createPromptBackedNodeDefinition.
 * Composite nodes (taskCode === null) cannot be reconstructed and are skipped.
 */
export async function loadSavedInstantNodes(projectDir: string): Promise<IDagNodeDefinition[]> {
  const nodesDir = join(projectDir, '.dag', 'nodes');
  let files: string[];
  try {
    files = await readdir(nodesDir);
  } catch (_err) {
    // allow-fallback: .dag/nodes/ may not exist; return empty
    return [];
  }
  const definitions: IDagNodeDefinition[] = [];
  for (const file of files.filter((f) => f.endsWith('.instant-node.json'))) {
    let raw: string;
    try {
      raw = await readFile(join(nodesDir, file), 'utf-8');
    } catch (_err) {
      // allow-fallback: unreadable file skipped
      continue;
    }
    let record: unknown;
    try {
      record = JSON.parse(raw);
    } catch (_err) {
      // allow-fallback: unparseable JSON skipped
      continue;
    }
    if (
      typeof record !== 'object' ||
      record === null ||
      typeof (record as Record<string, unknown>)['nodeType'] !== 'string' ||
      typeof (record as Record<string, unknown>)['taskCode'] !== 'string'
    ) {
      continue; // composite nodes (taskCode === null) cannot be reconstructed
    }
    const r = record as Record<string, unknown>;
    try {
      // allow-fallback: malformed spec causes skip
      const spec: ICreatePromptNodeInput = {
        nodeType: r['nodeType'] as string,
        displayName:
          typeof r['displayName'] === 'string' ? r['displayName'] : (r['nodeType'] as string),
        systemPromptTemplate: r['taskCode'] as string,
        inputPorts:
          Array.isArray(r['inputs']) && (r['inputs'] as unknown[]).length > 0
            ? (r['inputs'] as Array<{ key: string }>).map((p) => ({ key: p.key }))
            : [{ key: 'text' }],
        outputPort:
          Array.isArray(r['outputs']) && (r['outputs'] as unknown[]).length > 0
            ? { key: (r['outputs'] as Array<{ key: string }>)[0].key }
            : { key: 'text' },
      };
      definitions.push(createPromptBackedNodeDefinition(spec));
    } catch (_err) {
      // allow-fallback: construction failure causes skip
      continue;
    }
  }
  return definitions;
}

export async function handleInstantNodeListSaved(
  _args: Record<string, unknown>,
  ctx: ILocalMcpServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const nodesDir = join(ctx.options.projectDir ?? process.cwd(), '.dag', 'nodes');
  let files: string[];
  try {
    files = await readdir(nodesDir);
  } catch {
    // allow-fallback: .dag/nodes/ may not exist yet; treat as empty
    return {
      content: [
        {
          type: 'text',
          text: 'No saved instant nodes found (.dag/nodes/ does not exist).',
        },
      ],
    };
  }
  const jsonFiles = files.filter((f) => f.endsWith('.instant-node.json'));
  if (jsonFiles.length === 0) {
    return { content: [{ type: 'text', text: 'No saved instant nodes found.' }] };
  }
  const items: string[] = [];
  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(nodesDir, file), 'utf-8');
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
    content: [
      { type: 'text', text: `Saved instant nodes (${jsonFiles.length}):\n${items.join('\n')}` },
    ],
  };
}
