/**
 * `/workflows create "<natural-language description>" [--input key=value ...] [--name <name>]`
 *
 * Authors a workflow from a natural-language description using the agent-cli's ACTIVE provider,
 * saves it as a reusable `.workflows/<name>.json` artifact (plus any prompt-backed nodes under
 * `.workflows/nodes/`), runs it immediately in-process, and surfaces the saved path + outputs.
 *
 * FLOW-007 Phase 2 (existing nodes) + Phase 3 (on-the-fly prompt nodes).
 */
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';
import {
  createProviderFromSettings,
  ProviderConfigError,
  readProviderSettings,
} from '@robota-sdk/agent-framework';
import {
  DEFAULT_WORKSPACE_LAYOUT,
  type IDagDefinition,
  type IDagNodeDefinition,
  type INodeManifest,
  type IWorkspaceLayout,
} from '@robota-sdk/dag-core';
import {
  createPromptBackedNodeDefinition,
  isInstantNodeProvider,
  type TInstantNodeProvider,
} from '@robota-sdk/dag-node-instant-node';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

import { buildCatalogManifests, renderCatalogForPrompt } from './authoring/node-catalog.js';
import { authorWorkflowSpec } from './authoring/author.js';
import { parseAuthoredSpec, type IAuthoredPromptNode } from './authoring/spec.js';
import { assembleWorkflow } from './authoring/assemble.js';
import { executeDefinition } from './authoring/execute-workflow.js';
import { saveInstantNodeFile, saveWorkflowFile } from './persistence/workspace-writer.js';
import { loadInstantNodes } from './persistence/instant-node-loader.js';

/** Test/composition seam: how to resolve the provider and the current time. */
export interface IWorkflowsCreateDeps {
  readonly workspace?: IWorkspaceLayout;
  readonly providerDefinitions?: readonly IProviderDefinition[];
  /** Override provider resolution (tests inject a stub). Default: the active provider from settings. */
  readonly resolveProvider?: (cwd: string) => IAIProvider;
  /** Model passed to the authoring chat call. Default path resolves it from settings. */
  readonly model?: string;
  /** Override the createdAt timestamp for persisted nodes (tests inject a fixed value). */
  readonly now?: () => string;
}

interface IParsedCreateArgs {
  readonly description: string;
  readonly nameOverride?: string;
  readonly inputs: Record<string, string>;
}

/**
 * Split an argument string into tokens shell-style: unquoted whitespace separates tokens, and
 * single/double quotes (anywhere, e.g. `key="a b"`) protect whitespace and are stripped.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let hasContent = false;
  let quote: '"' | "'" | null = null;

  for (const ch of input) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasContent = true;
    } else if (/\s/.test(ch)) {
      if (hasContent) {
        tokens.push(current);
        current = '';
        hasContent = false;
      }
    } else {
      current += ch;
      hasContent = true;
    }
  }
  if (hasContent) tokens.push(current);
  return tokens;
}

/** Parse `create` args: leading non-flag tokens = description; then `--input k=v` / `--name`. */
export function parseCreateArgs(
  argStr: string,
): { ok: true; value: IParsedCreateArgs } | { ok: false; error: string } {
  const tokens = tokenize(argStr.trim());
  const descriptionParts: string[] = [];
  const inputs: Record<string, string> = {};
  let nameOverride: string | undefined;

  let i = 0;
  // Leading non-flag tokens form the description.
  while (i < tokens.length && !tokens[i]!.startsWith('--')) {
    descriptionParts.push(tokens[i]!);
    i += 1;
  }
  while (i < tokens.length) {
    const flag = tokens[i]!;
    if (flag === '--input') {
      const pair = tokens[i + 1];
      if (pair === undefined || pair.startsWith('--')) {
        return { ok: false, error: '--input requires a key=value argument.' };
      }
      const eq = pair.indexOf('=');
      if (eq <= 0) {
        return { ok: false, error: `--input must be key=value, got "${pair}".` };
      }
      inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
      i += 2;
    } else if (flag === '--name') {
      const next = tokens[i + 1];
      if (next === undefined || next.startsWith('--')) {
        return { ok: false, error: '--name requires a value.' };
      }
      nameOverride = next;
      i += 2;
    } else {
      return { ok: false, error: `create received unexpected flag: ${flag}` };
    }
  }

  const description = descriptionParts.join(' ').trim();
  if (description === '') {
    return { ok: false, error: 'A natural-language description is required.' };
  }
  return { ok: true, value: { description, ...(nameOverride ? { nameOverride } : {}), inputs } };
}

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

function formatOutputs(outputs: Record<string, unknown>): string {
  return JSON.stringify(outputs, null, 2);
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

/**
 * Execute `/workflows create`. Never throws — every failure (bad args, no provider, invalid spec,
 * unassemblable pipeline, run failure) is returned as a failed `ICommandResult`.
 */
export async function executeWorkflowsCreate(
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
      message: `${parsed.error}\nUsage: /workflows create "<description>" [--input key=value] [--name <name>]`,
    };
  }
  const { description, nameOverride, inputs } = parsed.value;

  // Resolve the ACTIVE provider FIRST — before writing anything (TC-04: no provider → clean error).
  // The provider's chat call needs an explicit model, so the default path also resolves it from
  // settings; the injected test seam supplies a stub (model optional).
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

  // Phase 3: create prompt-backed nodes for any `newNodes` and add them to the catalog + registry.
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
  const manifests: INodeManifest[] = fullCatalog.manifests;

  // Deterministically assemble the DAG.
  const assembled = assembleWorkflow({ ...spec, name }, manifests);
  if (!assembled.ok) {
    return { success: false, message: `Could not assemble workflow: ${assembled.error}` };
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
    const path = await saveInstantNodeFile(cwd, node, createdAt, layout);
    if (path) savedNodePaths.push(path);
  }
  const workflowPath = await saveWorkflowFile(cwd, name, definition, layout);

  const runNodes = [...existingInstantNodes, ...authoredNodes];
  const outcome = await executeDefinition(definition, cwd, layout, runNodes, runInputs);

  const nodeLine = savedNodePaths.length > 0 ? `\nNew nodes: ${savedNodePaths.join(', ')}` : '';
  if (!outcome.ok) {
    return {
      success: false,
      message: `Saved ${workflowPath}${nodeLine}\nBut the run failed (${outcome.durationMs}ms): ${outcome.error}\nInspect or edit the saved artifact and re-run with: /workflows run ${workflowPath}`,
    };
  }
  return {
    success: true,
    message: `Created and ran "${name}".\nSaved: ${workflowPath}${nodeLine}\nCompleted in ${outcome.durationMs}ms.\nOutputs: ${formatOutputs(outcome.outputs)}\nRe-run: /workflows run ${workflowPath}`,
  };
}
