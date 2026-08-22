/**
 * The single natural-language authoring pipeline shared by `/workflows create` and `/workflows
 * build` (WORKFLOW-005 P3 — previously each subcommand carried its own verbatim copy of these
 * steps, so a fix to one silently diverged from the other).
 *
 * Steps: parse args → resolve the ACTIVE provider → build the node catalog (built-ins + workspace
 * instant nodes) → author the spec via the provider → validate/parse it → materialize any `newNodes`
 * as prompt-backed nodes → assemble the DAG → bake the resolved input → persist nodes + workflow.
 *
 * **It stops at save.** This module MUST NOT import `authoring/execute-workflow.ts`: `build`'s
 * never-executes contract (WORKFLOW-004) is proven structurally by the fact that nothing on its
 * import path can construct a DAG runtime. Execution is `create`'s own final step, added after this
 * pipeline returns.
 */
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';
import {
  createProviderFromSettings,
  createDefaultUserSettingsSources,
  ProviderConfigError,
  readProviderSettings,
} from '@robota-sdk/agent-framework';
import { DEFAULT_WORKSPACE_LAYOUT, type IDagNodeDefinition } from '@robota-sdk/dag-core';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import {
  createPromptBackedNodeDefinition,
  isInstantNodeProvider,
  type TInstantNodeProvider,
} from '@robota-sdk/dag-node-instant-node';
import type { IAIProvider } from '@robota-sdk/agent-core';

import { subcommandUsage } from '../subcommands.js';
import { saveInstantNodeFile, saveWorkflowFile } from '../persistence/workspace-writer.js';
import { loadInstantNodes } from '../persistence/instant-node-loader.js';
import { buildCatalogManifests, renderCatalogForPrompt } from './node-catalog.js';
import { authorWorkflowSpec } from './author.js';
import { parseAuthoredSpec, type IAuthoredPromptNode } from './spec.js';
import { assembleWorkflow } from './assemble.js';
import type { IWorkflowsAuthoringDeps, IParsedAuthoringArgs } from './args.js';
import { parseAuthoringArgs } from './args.js';
import { assertWorkflowProject } from '../workflow-project.js';

import type { IWorkflowProject } from '../workflow-project.js';

/** What the pipeline produced and wrote. */
export interface IAuthoredWorkflow {
  readonly name: string;
  readonly definition: IDagDefinition;
  /** Project-relative path of the saved workflow artifact. */
  readonly workflowPath: string;
  /** Project-relative paths of any newly-saved instant-node manifests. */
  readonly savedNodePaths: readonly string[];
  /** Node definitions a run would need: the workspace's existing instant nodes + the authored ones. */
  readonly runNodes: readonly IDagNodeDefinition[];
  /** The resolved run input (explicit `--input` > the spec's `sampleInput`). */
  readonly runInputs: Record<string, string>;
}

export type TAuthoringOutcome =
  { ok: true; value: IAuthoredWorkflow } | { ok: false; message: string };

/**
 * Build a prompt-backed node definition from an authored `newNodes` entry. When the spec omits a
 * provider (the common case — the LLM rarely sets one), inherit the ACTIVE provider used for
 * authoring so the node doesn't silently hardcode-default to anthropic and fail for other providers.
 * The chosen provider is persisted in the node manifest for a deterministic reload.
 */
function buildPromptNode(
  spec: IAuthoredPromptNode,
  fallbackProvider: TInstantNodeProvider | undefined,
): IDagNodeDefinition {
  const provider = isInstantNodeProvider(spec.provider) ? spec.provider : fallbackProvider;
  return createPromptBackedNodeDefinition({
    nodeType: spec.nodeType,
    displayName: spec.displayName ?? spec.nodeType,
    systemPromptTemplate: spec.systemPromptTemplate,
    inputPorts: spec.inputPorts,
    outputPort: spec.outputPort,
    ...(provider ? { provider } : {}),
    ...(spec.model ? { model: spec.model } : {}),
  });
}

/**
 * Bake the resolved run input into the first `input` node's config so the saved artifact is
 * self-contained (reproduces on a bare `/workflows run`). Returns the definition unchanged when there
 * is no input to bake or no `input` node.
 */
function bakeInputIntoDefinition(
  definition: IDagDefinition,
  runInputs: Record<string, string>,
): IDagDefinition {
  if (Object.keys(runInputs).length === 0) return definition;
  let baked = false;
  const nodes = definition.nodes.map((node) => {
    if (baked || node.nodeType !== 'input') return node;
    baked = true;
    return {
      ...node,
      config: { ...node.config, ...runInputs },
    };
  });
  return { ...definition, nodes };
}

/** The provider (+ model + instant-node provider tag) the authoring call runs against. */
interface IResolvedAuthoringProvider {
  readonly provider: IAIProvider;
  readonly model: string | undefined;
  readonly activeProvider: TInstantNodeProvider | undefined;
}

/**
 * Resolve the ACTIVE provider FIRST — before writing anything (TC-04: no provider → clean error,
 * fs untouched). The provider's chat call needs an explicit model, so the default path also resolves
 * it from settings; the injected test seam supplies a stub (model optional).
 */
function resolveAuthoringProvider(
  project: IWorkflowProject,
  deps: IWorkflowsAuthoringDeps,
): { ok: true; value: IResolvedAuthoringProvider } | { ok: false; message: string } {
  const providerDefinitions = deps.providerDefinitions ?? [];
  try {
    if (deps.resolveProvider) {
      return {
        ok: true,
        value: {
          provider: deps.resolveProvider(project.executionRoot),
          model: deps.model,
          activeProvider: undefined,
        },
      };
    }
    const settingsSources = deps.settingsSources ?? createDefaultUserSettingsSources();
    const provider = createProviderFromSettings(settingsSources, undefined, {
      providerDefinitions,
    });
    const settings = readProviderSettings(settingsSources, { providerDefinitions });
    return {
      ok: true,
      value: {
        provider,
        model: deps.model ?? settings.model,
        activeProvider: isInstantNodeProvider(settings.name) ? settings.name : undefined,
      },
    };
  } catch (err) {
    const detail =
      err instanceof ProviderConfigError || err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `No active LLM provider is configured. Configure one (e.g. \`/provider\` or set the provider API key) and retry.\nDetail: ${detail}`,
    };
  }
}

/**
 * Run the shared authoring pipeline for `subcommand` (`create` or `build`) and persist the result.
 * Never throws — every failure is returned as a message for the caller's `ICommandResult`.
 */
export async function authorAndSaveWorkflow(
  argStr: string,
  project: IWorkflowProject,
  subcommand: 'create' | 'build',
  deps: IWorkflowsAuthoringDeps = {},
): Promise<TAuthoringOutcome> {
  const layout = deps.workspace ?? DEFAULT_WORKSPACE_LAYOUT;
  const acceptedProject = assertWorkflowProject(project);
  const now = deps.now ?? ((): string => new Date().toISOString());

  const parsed = parseAuthoringArgs(argStr);
  if (!parsed.ok) {
    return { ok: false, message: `${parsed.error}\n${subcommandUsage(subcommand)}` };
  }
  const { description, nameOverride, inputs }: IParsedAuthoringArgs = parsed.value;

  const resolved = resolveAuthoringProvider(acceptedProject, deps);
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const { provider, model, activeProvider } = resolved.value;

  // Node catalog = built-ins + any instant nodes already saved (so they can be reused).
  const existingInstantNodes = await loadInstantNodes(acceptedProject, layout);
  const baseNodeDefs: IDagNodeDefinition[] = [
    ...createDefaultNodeRegistrySync(),
    ...existingInstantNodes,
  ];
  const baseCatalog = buildCatalogManifests(baseNodeDefs);
  if (!baseCatalog.ok) {
    return { ok: false, message: `Failed to build node catalog: ${baseCatalog.error}` };
  }

  // Author the spec via the active provider.
  const authored = await authorWorkflowSpec(
    provider,
    description,
    renderCatalogForPrompt(baseCatalog.manifests),
    model,
  );
  if (!authored.ok) {
    return { ok: false, message: `Authoring failed: ${authored.error}` };
  }
  const specResult = parseAuthoredSpec(authored.raw);
  if (!specResult.ok) {
    return { ok: false, message: `Authoring produced an invalid spec: ${specResult.error}` };
  }
  const spec = specResult.spec;
  const name = nameOverride ?? spec.name;

  // Prompt-backed nodes for any `newNodes` — built in memory here, persisted as INERT manifests
  // below; creating or persisting a node definition executes nothing.
  const authoredNodes: IDagNodeDefinition[] = [];
  const existingTypes = new Set(baseNodeDefs.map((n) => n.nodeType));
  for (const nodeSpec of spec.newNodes ?? []) {
    if (existingTypes.has(nodeSpec.nodeType)) continue; // reuse existing; do not clobber
    authoredNodes.push(buildPromptNode(nodeSpec, activeProvider));
    existingTypes.add(nodeSpec.nodeType);
  }

  const fullCatalog = buildCatalogManifests([...baseNodeDefs, ...authoredNodes]);
  if (!fullCatalog.ok) {
    return { ok: false, message: `Failed to build node catalog: ${fullCatalog.error}` };
  }

  // Deterministically assemble the DAG — assembly failure means nothing is written.
  const assembled = assembleWorkflow({ ...spec, name }, fullCatalog.manifests);
  if (!assembled.ok) {
    return { ok: false, message: `Could not assemble workflow: ${assembled.error}` };
  }

  // Resolve the run input (explicit --input > spec.sampleInput) and bake it into the artifact's
  // `input` node config so the saved workflow is self-contained and reproduces on a bare re-run.
  const runInputs: Record<string, string> =
    Object.keys(inputs).length > 0 ? inputs : (spec.sampleInput ?? {});
  const definition = bakeInputIntoDefinition(assembled.definition, runInputs);

  // Persist authored prompt nodes, then the workflow (both reusable/re-runnable afterwards).
  const createdAt = now();
  const savedNodePaths: string[] = [];
  for (const node of authoredNodes) {
    try {
      const path = await saveInstantNodeFile(acceptedProject, node, createdAt, layout);
      if (path) savedNodePaths.push(path);
    } catch (error) {
      return {
        ok: false,
        message: `Failed to save workflow node: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  let workflowPath: string;
  try {
    workflowPath = await saveWorkflowFile(acceptedProject, name, definition, layout);
  } catch (error) {
    return {
      ok: false,
      message: `Failed to save workflow: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    ok: true,
    value: {
      name,
      definition,
      workflowPath,
      savedNodePaths,
      runNodes: [...existingInstantNodes, ...authoredNodes],
      runInputs,
    },
  };
}
