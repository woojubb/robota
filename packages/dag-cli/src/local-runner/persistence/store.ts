/**
 * Persistence store (DATA-002, WORKFLOW-005 P2).
 *
 * Single owner of the workspace save + load. Every node is a `.node.json` manifest (metadata SSOT,
 * discriminated by `kind`) under `<root>/nodes/`; a code node additionally has a supplementary
 * `.dag.node.js` companion. Workflow definitions live flat under the workspace `<root>` (data-only).
 * The workspace `<root>` + workflow extension are injected via an `IWorkspaceLayout` (FLOW-007),
 * defaulting to `.workflows/` + `.json`. Centralizes the path + readdir-skip boilerplate.
 */
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_WORKSPACE_LAYOUT,
  type IDagDefinition,
  type IDagNodeDefinition,
  type IWorkspaceLayout,
  type TPortPayload,
} from '@robota-sdk/dag-core';
import {
  createPromptBackedNodeDefinition,
  createCompositeInstantNodeDefinition,
  type ICreateCompositeNodeInput,
  type ICompositeSubRunner,
  type TInstantNodeProvider,
  type IPersistableInstantNode,
  type TPersistedInstantNode,
} from '@robota-sdk/dag-node-instant-node';
import { scanWorkspaceCatalog } from '@robota-sdk/dag-framework';
import { LocalDagRunner, createCliNodeRegistry } from '../index.js';
import { parseCodeManifest, reconstructCodeNode } from '../code-node-adapter.js';
import { NODE_MANIFEST_EXT, nodesDir, workflowsDir } from './paths.js';
import { safeParseJson } from '../../mcp/utils.js';

/** Narrow an arbitrary node definition to one that can serialize itself for reload. */
function asPersistable(nodeDef: IDagNodeDefinition): IPersistableInstantNode | undefined {
  return typeof (nodeDef as Partial<IPersistableInstantNode>).toPersisted === 'function'
    ? (nodeDef as unknown as IPersistableInstantNode)
    : undefined;
}

/**
 * Persist a node from its own serializable manifest view. Prompt AND composite nodes; the composite
 * `runner` is behavioral and is rebuilt on reload, never serialized.
 */
export async function saveNode(
  nodeDef: IDagNodeDefinition,
  projectDir: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<void> {
  const persistable = asPersistable(nodeDef);
  if (!persistable) return;
  const dir = nodesDir(projectDir, layout);
  await mkdir(dir, { recursive: true });
  const record = { ...persistable.toPersisted(), createdAt: new Date().toISOString() };
  await writeFile(
    join(dir, `${nodeDef.nodeType}${NODE_MANIFEST_EXT}`),
    JSON.stringify(record, null, 2),
    'utf-8',
  );
}

/**
 * Build a composite sub-runner that closes over the **live** definitions array so nested/other
 * nodes registered before OR after are visible at run time. Shared by create-time and reload.
 */
export function buildCompositeRunner(liveDefs: IDagNodeDefinition[]): ICompositeSubRunner {
  return {
    async run(dag, input) {
      const subRunner = new LocalDagRunner([...createCliNodeRegistry(), ...liveDefs]);
      try {
        // allow-fallback: inner DAG errors are returned as structured result
        const subResult = await subRunner.run(dag, input);
        const outputs: Record<string, TPortPayload> = {};
        for (const tr of subResult.taskRuns) {
          if (tr.outputSnapshot) {
            const parsed = safeParseJson(tr.outputSnapshot);
            if (typeof parsed === 'object' && parsed !== null) {
              outputs[tr.nodeId] = parsed as TPortPayload;
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

/** Parse an on-disk manifest into a discriminated persisted node record. */
function parsePersistedRecord(raw: unknown): TPersistedInstantNode | null {
  const r = toRecordObject(raw);
  if (!r || typeof r['nodeType'] !== 'string') return null;
  const nodeType = r['nodeType'];
  const displayName = typeof r['displayName'] === 'string' ? r['displayName'] : nodeType;

  if (r['kind'] === 'composite') {
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

  // prompt
  const template = r['systemPromptTemplate'];
  if (typeof template !== 'string') return null;
  const inputPorts = parsePortKeys(r['inputPorts']) ?? [{ key: 'text' }];
  const outputPorts = parsePortKeys(r['outputPort'] !== undefined ? [r['outputPort']] : undefined);
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

function reconstructNode(
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
 * Load persisted node manifests from `.dag/nodes/*.node.json` into `liveDefs`, skipping
 * already-registered/malformed records. Per manifest `kind`: prompt/composite reconstruct from the
 * manifest alone; `code` combines the manifest metadata with its companion `.dag.node.js` behavior.
 * Composite runners close over `liveDefs` so nested nodes resolve regardless of load order.
 */
export async function loadNodes(
  projectDir: string,
  liveDefs: IDagNodeDefinition[],
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<void> {
  const dir = nodesDir(projectDir, layout);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    // allow-fallback: .dag/nodes/ may not exist yet
    return;
  }
  for (const file of files.filter((f) => f.endsWith(NODE_MANIFEST_EXT))) {
    try {
      const raw = JSON.parse(await readFile(join(dir, file), 'utf-8')) as unknown;
      const codeManifest = parseCodeManifest(raw);
      if (codeManifest) {
        if (liveDefs.some((n) => n.nodeType === codeManifest.nodeType)) continue;
        const def = await reconstructCodeNode(dir, codeManifest);
        if (def) liveDefs.push(def);
        continue;
      }
      const record = parsePersistedRecord(raw);
      if (!record) continue;
      if (liveDefs.some((n) => n.nodeType === record.nodeType)) continue;
      liveDefs.push(reconstructNode(record, liveDefs));
    } catch {
      // allow-fallback: unreadable/unparseable/unconstructable record skipped
      continue;
    }
  }
}

// --- Workflows (data-only definitions, flat under the workspace root) ---

/** Persist a workflow definition to `<root>/<name><workflowExt>`. Returns the written path. */
export async function saveWorkflow(
  name: string,
  definition: IDagDefinition,
  projectDir: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<string> {
  const dir = workflowsDir(projectDir, layout);
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, `${name}${layout.workflowExt}`);
  await writeFile(outputPath, `${JSON.stringify(definition, null, 2)}\n`, 'utf-8');
  return outputPath;
}

/**
 * Load workflow definitions from the workspace root via the shared `scanWorkspaceCatalog` reader
 * (FLOW-007 C3 — one reader for all consumers). Returns `{ name, definition }` per valid file.
 */
export async function loadWorkflows(
  projectDir: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<Array<{ name: string; definition: IDagDefinition }>> {
  const entries = await scanWorkspaceCatalog(workflowsDir(projectDir, layout), layout);
  return entries.map((e) => ({ name: e.id, definition: e.definition }));
}
