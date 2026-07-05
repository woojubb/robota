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
  type IPersistableInstantNode,
  type TPersistedInstantNode,
} from '@robota-sdk/dag-node-instant-node';
import { LocalDagRunner, createCliNodeRegistry } from '../../local-runner/index.js';
import type { ILocalMcpServerContext } from '../context.js';
import { makeTextResult, makeErrorResult, safeParseJson } from '../utils.js';

/** Narrow an arbitrary node definition to one that can serialize itself for reload. */
function asPersistable(nodeDef: IDagNodeDefinition): IPersistableInstantNode | undefined {
  return typeof (nodeDef as Partial<IPersistableInstantNode>).toPersisted === 'function'
    ? (nodeDef as unknown as IPersistableInstantNode)
    : undefined;
}

/**
 * Persist an instant node from its own serializable view (BEHAVIOR-006). Works for prompt AND
 * composite nodes at every call site — the node owns its persisted data; the composite `runner`
 * is behavioral and is rebuilt on reload, never serialized.
 */
async function saveInstantNodeToDisk(
  nodeDef: IDagNodeDefinition,
  ctx: ILocalMcpServerContext,
): Promise<void> {
  const persistable = asPersistable(nodeDef);
  if (!persistable) return;
  const nodesDir = join(ctx.options.projectDir ?? process.cwd(), '.dag', 'nodes');
  await mkdir(nodesDir, { recursive: true });
  const record = { ...persistable.toPersisted(), createdAt: new Date().toISOString() };
  const filePath = join(nodesDir, `${nodeDef.nodeType}.instant-node.json`);
  await writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');
}

/**
 * Build a composite sub-runner that closes over the **live** definitions array so nested/other
 * instant nodes registered before OR after are visible at run time (Finding C). Shared by
 * create-time and reload.
 */
function buildCompositeRunner(liveDefs: IDagNodeDefinition[]): ICompositeSubRunner {
  return {
    async run(dag, input) {
      const subRunner = new LocalDagRunner([...createCliNodeRegistry(), ...liveDefs]);
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
  await saveInstantNodeToDisk(nodeDef, ctx);

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
  await saveInstantNodeToDisk(nodeDef, ctx);

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
  await saveInstantNodeToDisk(nodeDef, ctx);
  return {
    content: [
      {
        type: 'text',
        text: `Saved instant node "${nodeType}" to .dag/nodes/${nodeType}.instant-node.json`,
      },
    ],
  };
}

function toRecordObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function parsePortKeys(value: unknown): Array<{ key: string; description?: string }> | null {
  if (!Array.isArray(value)) return null;
  const ports = value
    .map((p) => toRecordObject(p))
    .filter((p): p is Record<string, unknown> => p !== null && typeof p['key'] === 'string')
    .map((p) => ({ key: p['key'] as string }));
  return ports.length > 0 ? ports : null;
}

/**
 * Parse an on-disk record into a discriminated persisted node (BEHAVIOR-006), with back-compat for
 * pre-fix files (no `kind`): a string `taskCode` → prompt; `taskCode:null` + `innerDag` → composite;
 * a `taskCode:null` with no `innerDag` (old composite) is unrecoverable → null (skipped).
 */
function parsePersistedRecord(raw: unknown): TPersistedInstantNode | null {
  const r = toRecordObject(raw);
  if (!r || typeof r['nodeType'] !== 'string') return null;
  const nodeType = r['nodeType'];
  const displayName = typeof r['displayName'] === 'string' ? r['displayName'] : nodeType;
  const kind = r['kind'];

  const isComposite =
    kind === 'composite' ||
    (kind === undefined && r['taskCode'] === null && toRecordObject(r['innerDag']) !== null);
  if (isComposite) {
    const innerDag = toRecordObject(r['innerDag']);
    const exposedInputPort = toRecordObject(r['exposedInputPort']);
    if (
      !innerDag ||
      !exposedInputPort ||
      typeof exposedInputPort['key'] !== 'string' ||
      !Array.isArray(r['exposedOutputPorts']) ||
      r['exposedOutputPorts'].length === 0
    ) {
      return null;
    }
    return {
      kind: 'composite',
      nodeType,
      displayName,
      innerDag: innerDag as unknown as import('@robota-sdk/dag-core').IDagDefinition,
      exposedInputPort:
        exposedInputPort as unknown as ICreateCompositeNodeInput['exposedInputPort'],
      exposedOutputPorts: r[
        'exposedOutputPorts'
      ] as unknown as ICreateCompositeNodeInput['exposedOutputPorts'],
      ...(typeof r['maxDepth'] === 'number' ? { maxDepth: r['maxDepth'] } : {}),
    };
  }

  // prompt — new (`kind:'prompt'` + `systemPromptTemplate`) or legacy (`taskCode` string).
  const template = kind === 'prompt' ? r['systemPromptTemplate'] : r['taskCode'];
  if (typeof template !== 'string') return null;
  const inputPorts = parsePortKeys(r['inputPorts']) ??
    parsePortKeys(r['inputs']) ?? [{ key: 'text' }];
  const outputPorts =
    parsePortKeys(r['outputPort'] !== undefined ? [r['outputPort']] : undefined) ??
    parsePortKeys(r['outputs']);
  return {
    kind: 'prompt',
    nodeType,
    displayName,
    systemPromptTemplate: template,
    inputPorts,
    outputPort: outputPorts ? { key: outputPorts[0].key } : { key: 'text' },
    ...(typeof r['provider'] === 'string'
      ? { provider: r['provider'] as TInstantNodeProvider }
      : {}),
    ...(typeof r['model'] === 'string' ? { model: r['model'] } : {}),
  };
}

function reconstructInstantNode(
  record: TPersistedInstantNode,
  liveDefs: IDagNodeDefinition[],
): IDagNodeDefinition {
  if (record.kind === 'composite') {
    return createCompositeInstantNodeDefinition({
      nodeType: record.nodeType,
      displayName: record.displayName,
      innerDag: record.innerDag,
      exposedInputPort: record.exposedInputPort,
      exposedOutputPorts: record.exposedOutputPorts,
      runner: buildCompositeRunner(liveDefs),
      ...(record.maxDepth !== undefined ? { maxDepth: record.maxDepth } : {}),
    });
  }
  return createPromptBackedNodeDefinition({
    nodeType: record.nodeType,
    displayName: record.displayName,
    systemPromptTemplate: record.systemPromptTemplate,
    inputPorts: record.inputPorts,
    outputPort: record.outputPort,
    ...(record.provider !== undefined ? { provider: record.provider } : {}),
    ...(record.model !== undefined ? { model: record.model } : {}),
  });
}

/**
 * Load saved instant nodes from `.dag/nodes/*.instant-node.json` and reconstruct them (prompt AND
 * composite — BEHAVIOR-006) into `liveDefs`, skipping already-registered/malformed records. Composite
 * runners close over `liveDefs` so nested instant nodes resolve regardless of load order.
 */
export async function loadSavedInstantNodes(
  projectDir: string,
  liveDefs: IDagNodeDefinition[],
): Promise<void> {
  const nodesDir = join(projectDir, '.dag', 'nodes');
  let files: string[];
  try {
    files = await readdir(nodesDir);
  } catch {
    // allow-fallback: .dag/nodes/ may not exist yet
    return;
  }
  for (const file of files.filter((f) => f.endsWith('.instant-node.json'))) {
    try {
      const record = parsePersistedRecord(
        JSON.parse(await readFile(join(nodesDir, file), 'utf-8')),
      );
      if (!record) continue;
      if (liveDefs.some((n) => n.nodeType === record.nodeType)) continue;
      liveDefs.push(reconstructInstantNode(record, liveDefs));
    } catch {
      // allow-fallback: unreadable/unparseable/unconstructable record skipped
      continue;
    }
  }
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
