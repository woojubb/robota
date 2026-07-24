/**
 * `/workflows build "<natural-language description>" [--input key=value ...] [--name <name>]`
 *
 * The generate-for-review counterpart to `create` (WORKFLOW-004): authors a workflow from a
 * natural-language description via the ACTIVE provider, validates + assembles it, and saves it as a
 * reusable `.workflows/<name>.json` artifact (plus any prompt-backed nodes under
 * `.workflows/nodes/`) — and STOPS. It never executes the authored graph: this module does not
 * import `authoring/execute-workflow.ts`, so no DAG runtime is constructed and no node (LLM or
 * side-effecting) runs. The explicit next steps are the existing `validate` / `run` subcommands.
 */
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';
import {
  createProviderFromSettings,
  ProviderConfigError,
  readProviderSettings,
} from '@robota-sdk/agent-framework';
import { DEFAULT_WORKSPACE_LAYOUT, type IDagNodeDefinition } from '@robota-sdk/dag-core';
import {
  isInstantNodeProvider,
  type TInstantNodeProvider,
} from '@robota-sdk/dag-node-instant-node';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

import { buildCatalogManifests, renderCatalogForPrompt } from './authoring/node-catalog.js';
import { authorWorkflowSpec } from './authoring/author.js';
import { parseAuthoredSpec } from './authoring/spec.js';
import { assembleWorkflow } from './authoring/assemble.js';
import { saveInstantNodeFile, saveWorkflowFile } from './persistence/workspace-writer.js';
import { loadInstantNodes } from './persistence/instant-node-loader.js';
import {
  bakeInputIntoDefinition,
  buildPromptNode,
  parseCreateArgs,
  type IWorkflowsCreateDeps,
} from './create-command.js';

/**
 * Execute `/workflows build`. Never throws — every failure (bad args, no provider, invalid spec,
 * unassemblable pipeline, write failure) is returned as a failed `ICommandResult`. Shares the
 * `create` deps seam (`IWorkflowsCreateDeps`) and arg grammar (`parseCreateArgs`).
 */
export async function executeWorkflowsBuild(
  argStr: string,
  cwd: string,
  deps: IWorkflowsCreateDeps = {},
): Promise<ICommandResult> {
  const layout = deps.workspace ?? DEFAULT_WORKSPACE_LAYOUT;
  const now = deps.now ?? ((): string => new Date().toISOString());

  const parsed = parseCreateArgs(argStr);
  if (!parsed.ok) {
    return {
      success: false,
      message: `${parsed.error}\nUsage: /workflows build "<description>" [--input key=value] [--name <name>]`,
    };
  }
  const { description, nameOverride, inputs } = parsed.value;

  // Resolve the ACTIVE provider FIRST — before writing anything (TC-04: no provider → clean error).
  const providerDefinitions = deps.providerDefinitions ?? [];
  let provider: IAIProvider;
  let model = deps.model;
  let activeProvider: TInstantNodeProvider | undefined;
  try {
    if (deps.resolveProvider) {
      provider = deps.resolveProvider(cwd);
    } else {
      provider = createProviderFromSettings(cwd, undefined, { providerDefinitions });
      const settings = readProviderSettings(cwd, { providerDefinitions });
      model = model ?? settings.model;
      activeProvider = isInstantNodeProvider(settings.name) ? settings.name : undefined;
    }
  } catch (err) {
    const detail =
      err instanceof ProviderConfigError || err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `No active LLM provider is configured. Configure one (e.g. \`/provider\` or set the provider API key) and retry.\nDetail: ${detail}`,
    };
  }

  // Node catalog = built-ins + any prompt nodes already saved (so they can be reused).
  const existingInstantNodes = await loadInstantNodes(cwd, layout);
  const baseNodeDefs: IDagNodeDefinition[] = [
    ...createDefaultNodeRegistrySync(),
    ...existingInstantNodes,
  ];
  const baseCatalog = buildCatalogManifests(baseNodeDefs);
  if (!baseCatalog.ok) {
    return { success: false, message: `Failed to build node catalog: ${baseCatalog.error}` };
  }

  // Author the spec via the active provider.
  const authored = await authorWorkflowSpec(
    provider,
    description,
    renderCatalogForPrompt(baseCatalog.manifests),
    model,
  );
  if (!authored.ok) {
    return { success: false, message: `Authoring failed: ${authored.error}` };
  }
  const specResult = parseAuthoredSpec(authored.raw);
  if (!specResult.ok) {
    return { success: false, message: `Authoring produced an invalid spec: ${specResult.error}` };
  }
  const spec = specResult.spec;
  const name = nameOverride ?? spec.name;

  // Prompt-backed nodes for any `newNodes` — created in memory and persisted as INERT manifests
  // below; persisting a node definition executes nothing.
  const authoredNodes: IDagNodeDefinition[] = [];
  const existingTypes = new Set(baseNodeDefs.map((n) => n.nodeType));
  for (const nodeSpec of spec.newNodes ?? []) {
    if (existingTypes.has(nodeSpec.nodeType)) continue; // reuse existing; do not clobber
    authoredNodes.push(buildPromptNode(nodeSpec, activeProvider));
    existingTypes.add(nodeSpec.nodeType);
  }

  const allNodeDefs = [...baseNodeDefs, ...authoredNodes];
  const fullCatalog = buildCatalogManifests(allNodeDefs);
  if (!fullCatalog.ok) {
    return { success: false, message: `Failed to build node catalog: ${fullCatalog.error}` };
  }

  // Deterministically assemble the DAG — assembly failure means nothing is written.
  const assembled = assembleWorkflow({ ...spec, name }, fullCatalog.manifests);
  if (!assembled.ok) {
    return { success: false, message: `Could not assemble workflow: ${assembled.error}` };
  }

  // Bake the resolved input (explicit --input > spec.sampleInput) into the artifact's `input` node
  // so the saved workflow is self-contained (same rule as `create`).
  const runInputs: Record<string, string> =
    Object.keys(inputs).length > 0 ? inputs : (spec.sampleInput ?? {});
  const definition = bakeInputIntoDefinition(assembled.definition, runInputs);

  // Persist authored prompt nodes, then the workflow. That is the end of `build` — no execution.
  const createdAt = now();
  const savedNodePaths: string[] = [];
  for (const node of authoredNodes) {
    const path = await saveInstantNodeFile(cwd, node, createdAt, layout);
    if (path) savedNodePaths.push(path);
  }
  const workflowPath = await saveWorkflowFile(cwd, name, definition, layout);

  const nodeLine = savedNodePaths.length > 0 ? `\nNew nodes: ${savedNodePaths.join(', ')}` : '';
  return {
    success: true,
    message:
      `Built "${name}" (${definition.nodes.length} node(s), ${definition.edges.length} edge(s)) — saved, not run.\n` +
      `Saved: ${workflowPath}${nodeLine}\n` +
      `Next steps:\n` +
      `  /workflows validate ${workflowPath}\n` +
      `  /workflows run ${workflowPath}`,
  };
}
