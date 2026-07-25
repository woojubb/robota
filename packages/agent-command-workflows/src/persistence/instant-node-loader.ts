/**
 * Reloads instant nodes previously saved under `<root>/nodes/*.node.json` so authored workflows that
 * reference them can run, and so a later `create` can reuse them. Parsing + reconstruction are owned
 * by `@robota-sdk/dag-node-instant-node` (DATA-003) — this module walks the directory and, for
 * composite (DAG-wrapping) nodes, supplies the behavioral sub-runner that is never serialized
 * (WORKFLOW-005 P2). The sub-runner executes the inner DAG on the in-process local runtime
 * (`dag-framework`), so composites round-trip on the agent `/workflows` path without depending on the
 * `dag-cli` product.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';
import type { IDagNodeDefinition, IDagRuntimeResult, TPortPayload } from '@robota-sdk/dag-core';
import {
  parsePersistedInstantNode,
  rehydrateInstantNode,
  type ICompositeSubRunner,
} from '@robota-sdk/dag-node-instant-node';
import { LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';
import { toDagWorkflowFile } from '@robota-sdk/dag-builder';

const NODE_MANIFEST_EXT = '.node.json';

/**
 * Reshape the runtime provider's flat `"<nodeId>.<port>"` output map into the nested
 * `Record<nodeId, TPortPayload>` shape the composite node contract reads back
 * (`CompositeInstantNodeDefinition` looks up `outputs[nodeId][portKey]`). Runtime node ids are
 * remapped to the inner DAG's original node ids via `runtimeToOriginal` (see `buildCompositeRunner`),
 * falling back to the runtime id when unmapped.
 */
function toNestedOutputs(
  flat: IDagRuntimeResult['outputs'],
  runtimeToOriginal: Map<string, string>,
): Record<string, TPortPayload> {
  const nested: Record<string, TPortPayload> = {};
  for (const [compound, value] of Object.entries(flat)) {
    const dot = compound.indexOf('.');
    if (dot <= 0) continue;
    const runtimeNodeId = compound.slice(0, dot);
    const portKey = compound.slice(dot + 1);
    const nodeId = runtimeToOriginal.get(runtimeNodeId) ?? runtimeNodeId;
    (nested[nodeId] ??= {})[portKey] = value as TPortPayload[string];
  }
  return nested;
}

/**
 * Build a composite sub-runner backed by the in-process local runtime. It closes over the **live**
 * `liveDefs` array so an inner DAG can reference other reloaded instant nodes regardless of load
 * order (they are resolved at run time, not load time).
 *
 * The provider consumes the ComfyUI-style workflow-file format and, lacking the companion, re-keys
 * nodes to `node-<numId>`; the composite contract reads its exposed outputs by the inner DAG's
 * ORIGINAL node ids, so the companion `toDagWorkflowFile` emits is used to remap runtime ids back.
 */
function buildCompositeRunner(
  cwd: string,
  layout: IWorkspaceLayout,
  liveDefs: IDagNodeDefinition[],
): ICompositeSubRunner {
  return {
    async run(dag, input) {
      const provider = new LocalDagRuntimeProvider({
        workspace: layout,
        projectDir: cwd,
        ...(liveDefs.length > 0 ? { instantNodes: liveDefs } : {}),
      });
      const { workflowFile, companion } = toDagWorkflowFile(dag);
      // The provider runs `fromDagWorkflowFile(file, undefined)`, so an original id `<x>` at numeric
      // id `<n>` surfaces in outputs as `node-<n>.<port>`. Rebuild `node-<n>` → `<x>` from the
      // companion the converter just produced.
      const runtimeToOriginal = new Map<string, string>();
      for (const [numId, meta] of Object.entries(companion.nodes)) {
        runtimeToOriginal.set(`node-${numId}`, meta.nodeId);
      }
      const result = await provider.execute(workflowFile, input);
      return {
        ok: result.ok,
        outputs: toNestedOutputs(result.outputs, runtimeToOriginal),
        ...(result.ok ? {} : { error: result.error ?? 'Inner DAG run failed' }),
      };
    },
  };
}

/**
 * Load all reloadable instant nodes from `<cwd>/<root>/nodes/`. Missing dir → empty list;
 * unparseable manifests are skipped. Prompt and composite nodes both round-trip through the shared
 * `@robota-sdk/dag-node-instant-node` abstraction; composites get an injected sub-runner (never
 * serialized) that runs the inner DAG on the in-process runtime.
 */
export async function loadInstantNodes(
  cwd: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<IDagNodeDefinition[]> {
  const dir = resolve(cwd, join(layout.root, 'nodes'));
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    // allow-fallback: nodes dir may not exist yet → no local nodes
    return [];
  }
  const nodes: IDagNodeDefinition[] = [];
  const compositeRunner = buildCompositeRunner(cwd, layout, nodes);
  for (const file of files.filter((f) => f.endsWith(NODE_MANIFEST_EXT))) {
    let record: ReturnType<typeof parsePersistedInstantNode>;
    try {
      record = parsePersistedInstantNode(JSON.parse(await readFile(join(dir, file), 'utf-8')));
    } catch {
      // allow-fallback: unreadable/unparseable manifest skipped
      continue;
    }
    if (!record) continue;
    nodes.push(
      rehydrateInstantNode(record, record.kind === 'composite' ? { compositeRunner } : {}),
    );
  }
  return nodes;
}
