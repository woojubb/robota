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
  parsePersistedInstantNode,
  rehydrateInstantNode,
  isPersistableInstantNode,
  type ICompositeSubRunner,
} from '@robota-sdk/dag-node-instant-node';
import { scanWorkspaceCatalog } from '@robota-sdk/dag-framework';
import { LocalDagRunner, createCliNodeRegistry } from '../index.js';
import { parseCodeManifest, reconstructCodeNode } from '../code-node-adapter.js';
import { NODE_MANIFEST_EXT, nodesDir, workflowsDir } from './paths.js';
import { safeParseJson } from '../../mcp/utils.js';

/**
 * Persist a node from its own serializable manifest view. Prompt AND composite nodes; the composite
 * `runner` is behavioral and is rebuilt on reload, never serialized.
 */
export async function saveNode(
  nodeDef: IDagNodeDefinition,
  projectDir: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<void> {
  if (!isPersistableInstantNode(nodeDef)) return;
  const dir = nodesDir(projectDir, layout);
  await mkdir(dir, { recursive: true });
  const record = { ...nodeDef.toPersisted(), createdAt: new Date().toISOString() };
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
      // Instant nodes (prompt/composite) parse + rehydrate through the owner round-trip (DATA-004);
      // dag-cli supplies only the composite sub-runner, which closes over its LocalDagRunner.
      const record = parsePersistedInstantNode(raw);
      if (!record) continue;
      if (liveDefs.some((n) => n.nodeType === record.nodeType)) continue;
      liveDefs.push(
        rehydrateInstantNode(record, { compositeRunner: buildCompositeRunner(liveDefs) }),
      );
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
