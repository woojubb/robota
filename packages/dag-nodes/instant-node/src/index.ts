import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
import {
  buildTaskExecutionError,
  buildValidationError,
  type ICostEstimate,
  type IDagDefinition,
  type IDagError,
  type IDagNodeDefinition,
  type INodeExecutionContext,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';
import {
  Robota,
  createProviderFromConfig,
  findProviderDefinition,
  formatSupportedProviderTypes,
  normalizeProviderConfig,
  type IProviderDefinition,
} from '@robota-sdk/agent-core';
import { z } from 'zod';

import { decodePersistedComposite } from './persisted-composite-decoder.js';

export interface ICreatePromptNodeInput {
  readonly nodeType: string;
  readonly displayName: string;
  readonly systemPromptTemplate: string;
  readonly inputPorts: ReadonlyArray<{
    readonly key: string;
    readonly description?: string;
  }>;
  readonly outputPort: {
    readonly key: string;
    readonly description?: string;
  };
  readonly provider?: string;
  readonly model?: string;
}

const PromptBackedConfigSchema = z.object({
  model: z.string().optional(),
});

function renderTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [key, value]) => t.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function resolveProviderInstance(
  provider: string,
  model: string | undefined,
  providers: readonly IProviderDefinition[],
): { agent: Robota } | { error: IDagError } {
  const definition = findProviderDefinition(providers, provider);
  if (definition === undefined) {
    return {
      error: buildValidationError(
        'DAG_VALIDATION_INSTANT_NODE_PROVIDER_UNKNOWN',
        `Instant node provider "${provider}" is not in the injected provider registry`,
        { provider, available: formatSupportedProviderTypes(providers) },
        {
          action: 'select_provider',
          suggestion: 'Select a provider registered by the composition root',
          options: providers.map((item) => `Use provider "${item.type}" instead`),
        },
      ),
    };
  }

  let config;
  try {
    config = normalizeProviderConfig(
      { name: provider, ...(model !== undefined ? { model } : {}) },
      providers,
    );
  } catch (error) {
    return {
      error: buildValidationError(
        'DAG_VALIDATION_INSTANT_NODE_MODEL_REQUIRED',
        error instanceof Error ? error.message : `Provider ${provider} requires a model`,
        { provider },
      ),
    };
  }

  try {
    return {
      agent: new Robota({
        name: `InstantNode_${provider}`,
        aiProviders: [createProviderFromConfig(config, providers)],
        defaultModel: { provider: definition.type, model: config.model },
      }),
    };
  } catch (error) {
    return {
      error: buildValidationError(
        'DAG_VALIDATION_INSTANT_NODE_API_KEY_REQUIRED',
        error instanceof Error ? error.message : `Provider "${provider}" requires a credential`,
        { provider },
        {
          action: 'add_api_key',
          suggestion: `Configure the credential required by provider "${provider}"`,
        },
      ),
    };
  }
}

export class PromptBackedNodeDefinition
  extends AbstractNodeDefinition<typeof PromptBackedConfigSchema>
  implements IPersistableInstantNode
{
  public readonly nodeType: string;
  public readonly displayName: string;
  public readonly category = 'Instant';
  public readonly inputs: IDagNodeDefinition['inputs'];
  public readonly outputs: IDagNodeDefinition['outputs'];
  public override readonly defaultInputPort: string | undefined;
  public override readonly defaultOutputPort: string;
  public readonly configSchemaDefinition = PromptBackedConfigSchema;

  private readonly spec: ICreatePromptNodeInput;
  private readonly providers: readonly IProviderDefinition[];

  public constructor(spec: ICreatePromptNodeInput, providers: readonly IProviderDefinition[]) {
    super();
    this.spec = spec;
    this.providers = providers;
    this.nodeType = spec.nodeType;
    this.displayName = spec.displayName;
    this.inputs = spec.inputPorts.map((p, i) => ({
      key: p.key,
      label: p.key,
      order: i,
      type: 'string' as const,
      required: true,
      description: p.description,
    }));
    this.outputs = [
      {
        key: spec.outputPort.key,
        label: spec.outputPort.key,
        order: 0,
        type: 'string' as const,
        required: true,
        description: spec.outputPort.description,
      },
    ];
    this.defaultInputPort = spec.inputPorts[0]?.key;
    this.defaultOutputPort = spec.outputPort.key;
  }

  public toPersisted(): IPersistedPromptNode {
    return {
      kind: 'prompt',
      nodeType: this.spec.nodeType,
      displayName: this.spec.displayName,
      systemPromptTemplate: this.spec.systemPromptTemplate,
      inputPorts: this.spec.inputPorts,
      outputPort: this.spec.outputPort,
      ...(this.spec.provider !== undefined ? { provider: this.spec.provider } : {}),
      ...(this.spec.model !== undefined ? { model: this.spec.model } : {}),
    };
  }

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return { ok: true, value: { estimatedCredits: 0 } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof PromptBackedConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);

    const vars: Record<string, string> = {};
    for (const portDef of this.spec.inputPorts) {
      const result = io.requireInputString(portDef.key);
      if (!result.ok) return result;
      vars[portDef.key] = result.value;
    }

    const provider = this.spec.provider ?? 'anthropic';
    const model = config.model ?? this.spec.model;

    const providerResult = resolveProviderInstance(provider, model, this.providers);
    if ('error' in providerResult) {
      return { ok: false, error: providerResult.error };
    }

    const renderedPrompt = renderTemplate(this.spec.systemPromptTemplate, vars);

    try {
      // allow-fallback: catches provider API errors and converts to structured Result
      const completion = await providerResult.agent.run(renderedPrompt);
      io.setOutput(this.spec.outputPort.key, completion);
      const wordCount = typeof completion === 'string' ? completion.split(' ').length : 0;
      io.setOutput('_agentSummary', `Generated ${wordCount} words. Model: ${model ?? 'default'}.`);
      return { ok: true, value: io.toOutput() };
    } catch (error) {
      // allow-fallback: catches provider API errors and converts to structured Result
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_LLM_GENERATION_FAILED',
          error instanceof Error ? error.message : 'LLM generation failed',
          true,
          { provider, model: model ?? 'default', nodeType: this.nodeType },
        ),
      };
    }
  }
}

export function createPromptBackedNodeDefinition(
  spec: ICreatePromptNodeInput,
  providers: readonly IProviderDefinition[],
): PromptBackedNodeDefinition {
  return new PromptBackedNodeDefinition(spec, providers);
}

// ── Composite Instant Nodes (INSTANT-002) ──────────────────────────────────

export interface ICompositeSubRunner {
  run(
    dag: import('@robota-sdk/dag-core').IDagDefinition,
    input: TPortPayload,
  ): Promise<{
    ok: boolean;
    outputs: Record<string, TPortPayload>;
    error?: string;
  }>;
}

export interface IExposedInputPort {
  readonly key: string;
  readonly mapsTo: { readonly nodeId: string; readonly portKey: string };
  readonly description?: string;
}

export interface IExposedOutputPort {
  readonly key: string;
  readonly mapsTo: { readonly nodeId: string; readonly portKey: string };
  readonly description?: string;
}

export interface ICreateCompositeNodeInput {
  readonly nodeType: string;
  readonly displayName: string;
  readonly innerDag: import('@robota-sdk/dag-core').IDagDefinition;
  readonly exposedInputPort: IExposedInputPort;
  readonly exposedOutputPorts: ReadonlyArray<IExposedOutputPort>;
  readonly runner: ICompositeSubRunner;
  readonly maxDepth?: number;
}

// ── Persistence view (BEHAVIOR-006) ─────────────────────────────────────────

export interface IPersistedPromptNode {
  readonly kind: 'prompt';
  readonly nodeType: string;
  readonly displayName: string;
  readonly systemPromptTemplate: string;
  readonly inputPorts: ReadonlyArray<{ readonly key: string; readonly description?: string }>;
  readonly outputPort: { readonly key: string; readonly description?: string };
  readonly provider?: string;
  readonly model?: string;
}

export interface IPersistedCompositeNode {
  readonly kind: 'composite';
  readonly nodeType: string;
  readonly displayName: string;
  readonly innerDag: import('@robota-sdk/dag-core').IDagDefinition;
  readonly exposedInputPort: IExposedInputPort;
  readonly exposedOutputPorts: ReadonlyArray<IExposedOutputPort>;
  readonly maxDepth?: number;
}

export type TPersistedInstantNode = IPersistedPromptNode | IPersistedCompositeNode;

/**
 * An instant-node definition that can serialize itself for a save→reload round-trip.
 * The `runner` of a composite is behavioral and is rebuilt on reload — never serialized.
 */
export interface IPersistableInstantNode {
  toPersisted(): TPersistedInstantNode;
}

const MAX_COMPOSITE_DEPTH = 3;

export class CompositeInstantNodeDefinition
  extends AbstractNodeDefinition<typeof PromptBackedConfigSchema>
  implements IPersistableInstantNode
{
  public readonly nodeType: string;
  public readonly displayName: string;
  public readonly category = 'Instant';
  public readonly inputs: IDagNodeDefinition['inputs'];
  public readonly outputs: IDagNodeDefinition['outputs'];
  public override readonly defaultInputPort: string | undefined;
  public override readonly defaultOutputPort: string;
  public readonly configSchemaDefinition = PromptBackedConfigSchema;

  private readonly spec: ICreateCompositeNodeInput;

  public constructor(spec: ICreateCompositeNodeInput) {
    super();
    const depth = spec.maxDepth ?? 0;
    if (depth >= MAX_COMPOSITE_DEPTH) {
      throw new Error(
        `Composite node nesting limit (${MAX_COMPOSITE_DEPTH}) exceeded for "${spec.nodeType}"`,
      );
    }
    this.spec = spec;
    this.nodeType = spec.nodeType;
    this.displayName = spec.displayName;
    this.inputs = [
      {
        key: spec.exposedInputPort.key,
        label: spec.exposedInputPort.key,
        order: 0,
        type: 'string' as const,
        required: true,
        description: spec.exposedInputPort.description,
      },
    ];
    this.outputs = spec.exposedOutputPorts.map((p, i) => ({
      key: p.key,
      label: p.key,
      order: i,
      type: 'string' as const,
      required: true,
      description: p.description,
    }));
    this.defaultInputPort = spec.exposedInputPort.key;
    this.defaultOutputPort = spec.exposedOutputPorts[0]?.key ?? 'output';
  }

  public toPersisted(): IPersistedCompositeNode {
    return {
      kind: 'composite',
      nodeType: this.spec.nodeType,
      displayName: this.spec.displayName,
      innerDag: this.spec.innerDag,
      exposedInputPort: this.spec.exposedInputPort,
      exposedOutputPorts: this.spec.exposedOutputPorts,
      ...(this.spec.maxDepth !== undefined ? { maxDepth: this.spec.maxDepth } : {}),
    };
  }

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return { ok: true, value: { estimatedCredits: 0 } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    _config: z.output<typeof PromptBackedConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const inputResult = io.requireInputString(this.spec.exposedInputPort.key);
    if (!inputResult.ok) return inputResult;

    const subInput: TPortPayload = {
      [this.spec.exposedInputPort.mapsTo.nodeId]: {
        [this.spec.exposedInputPort.mapsTo.portKey]: inputResult.value,
      },
    };

    try {
      // allow-fallback: sub-DAG execution errors are caught and surfaced as structured Result
      const result = await this.spec.runner.run(this.spec.innerDag, subInput);
      if (!result.ok) {
        return {
          ok: false,
          error: buildTaskExecutionError(
            'DAG_TASK_EXECUTION_COMPOSITE_FAILED',
            result.error ?? 'Composite sub-DAG execution failed',
            true,
            { nodeType: this.nodeType },
          ),
        };
      }

      for (const outPort of this.spec.exposedOutputPorts) {
        const nodeOutputs = result.outputs[outPort.mapsTo.nodeId];
        const value = nodeOutputs?.[outPort.mapsTo.portKey];
        if (value !== undefined) {
          io.setOutput(outPort.key, value);
        }
      }
      io.setOutput(
        '_agentSummary',
        `Composite sub-DAG completed: ${this.spec.innerDag.nodes.length} nodes.`,
      );
      return { ok: true, value: io.toOutput() };
    } catch (err) {
      // allow-fallback: sub-DAG execution errors are caught and surfaced as structured Result
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_COMPOSITE_FAILED',
          err instanceof Error ? err.message : 'Composite sub-DAG execution failed',
          true,
          { nodeType: this.nodeType },
        ),
      };
    }
  }
}

export function createCompositeInstantNodeDefinition(
  spec: ICreateCompositeNodeInput,
): CompositeInstantNodeDefinition {
  return new CompositeInstantNodeDefinition(spec);
}

// ── Persistence round-trip (DATA-003) ───────────────────────────────────────
// The write half (`IPersistableInstantNode.toPersisted()`) lives on the node classes above; this is
// the matching read half — parse an untrusted manifest into a typed record, then reconstruct a live
// definition — so consumers no longer hand-roll (an incomplete) deserialization.

/** Runtime guard: does this value implement the persistable instant-node contract? (DATA-003 F4) */
export function isPersistableInstantNode(node: unknown): node is IPersistableInstantNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    typeof (node as { toPersisted?: unknown }).toPersisted === 'function'
  );
}

function asPersistedRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsePersistedPorts(value: unknown): Array<{ key: string; description?: string }> | null {
  if (!Array.isArray(value)) return null;
  const ports: Array<{ key: string; description?: string }> = [];
  for (const raw of value) {
    const r = asPersistedRecord(raw);
    if (!r || typeof r['key'] !== 'string') return null;
    ports.push(
      typeof r['description'] === 'string'
        ? { key: r['key'], description: r['description'] }
        : { key: r['key'] },
    );
  }
  return ports.length > 0 ? ports : null;
}

/**
 * Validate a raw parsed manifest (untrusted JSON) into a typed `TPersistedInstantNode`, or `null` if
 * it is not a well-formed prompt/composite record. Covers both kinds (DATA-003 F2). Never throws.
 */
export function parsePersistedInstantNode(raw: unknown): TPersistedInstantNode | null {
  const r = asPersistedRecord(raw);
  if (!r || typeof r['nodeType'] !== 'string') return null;
  const nodeType = r['nodeType'];
  const displayName = typeof r['displayName'] === 'string' ? r['displayName'] : nodeType;

  if (r['kind'] === 'composite') {
    // Issue #2077: the inner DAG goes through the canonical dag-core decoder and the wrapper's
    // exposed ports through a package-owned total decoder — no cast on a top-level check.
    const composite = decodePersistedComposite(r);
    return composite === null ? null : { kind: 'composite', nodeType, displayName, ...composite };
  }

  // prompt (default kind)
  if (typeof r['systemPromptTemplate'] !== 'string') return null;
  const inputPorts = parsePersistedPorts(r['inputPorts']);
  const outputPort = asPersistedRecord(r['outputPort']);
  if (!inputPorts || !outputPort || typeof outputPort['key'] !== 'string') return null;
  return {
    kind: 'prompt',
    nodeType,
    displayName,
    systemPromptTemplate: r['systemPromptTemplate'],
    inputPorts,
    outputPort:
      typeof outputPort['description'] === 'string'
        ? { key: outputPort['key'], description: outputPort['description'] }
        : { key: outputPort['key'] },
    ...(typeof r['provider'] === 'string' ? { provider: r['provider'] } : {}),
    ...(typeof r['model'] === 'string' ? { model: r['model'] } : {}),
  };
}

export interface IRehydrateInstantNodeDeps {
  /**
   * Sub-runner for a composite node — behavioral, never serialized, so it must be supplied on reload.
   * Required for `kind: 'composite'`; ignored for prompt nodes.
   */
  readonly compositeRunner?: ICompositeSubRunner;
  /** Provider definitions are supplied by the composition root for prompt nodes. */
  readonly providers?: readonly IProviderDefinition[];
}

/**
 * Reconstruct a live instant-node definition from a typed persisted record (DATA-003 F2) — the read
 * half of `toPersisted()`. A composite node requires an injected `compositeRunner`; omitting it throws
 * rather than returning a half-built node (no silent partial).
 */
export function rehydrateInstantNode(
  record: TPersistedInstantNode,
  deps: IRehydrateInstantNodeDeps = {},
): IDagNodeDefinition {
  if (record.kind === 'composite') {
    if (!deps.compositeRunner) {
      throw new Error(
        `rehydrateInstantNode: composite node "${record.nodeType}" requires a compositeRunner (its runner is not serialized).`,
      );
    }
    return createCompositeInstantNodeDefinition({
      nodeType: record.nodeType,
      displayName: record.displayName,
      innerDag: record.innerDag,
      exposedInputPort: record.exposedInputPort,
      exposedOutputPorts: record.exposedOutputPorts,
      runner: deps.compositeRunner,
      ...(record.maxDepth !== undefined ? { maxDepth: record.maxDepth } : {}),
    });
  }
  const providers = deps.providers ?? [];
  if (findProviderDefinition(providers, record.provider ?? 'anthropic') === undefined) {
    throw new Error(
      `DAG_VALIDATION_INSTANT_NODE_PROVIDER_UNKNOWN: provider "${record.provider ?? 'anthropic'}" is not in the injected provider registry`,
    );
  }
  return createPromptBackedNodeDefinition(
    {
      nodeType: record.nodeType,
      displayName: record.displayName,
      systemPromptTemplate: record.systemPromptTemplate,
      inputPorts: record.inputPorts,
      outputPort: record.outputPort,
      ...(record.provider !== undefined ? { provider: record.provider } : {}),
      ...(record.model !== undefined ? { model: record.model } : {}),
    },
    providers,
  );
}
