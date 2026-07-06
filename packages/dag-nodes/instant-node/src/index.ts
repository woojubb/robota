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
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';
import { GoogleProvider } from '@robota-sdk/agent-provider/google';
import { DeepSeekProvider } from '@robota-sdk/agent-provider/deepseek';
import { QwenProvider } from '@robota-sdk/agent-provider/qwen';
import { z } from 'zod';

/**
 * The single runtime source of truth for the supported instant-node providers. The `TInstantNodeProvider`
 * type is derived from it, so adding a provider is a one-line change here (DATA-003 F1).
 */
export const INSTANT_NODE_PROVIDERS = [
  'anthropic',
  'openai',
  'gemini',
  'deepseek',
  'qwen',
] as const;

export type TInstantNodeProvider = (typeof INSTANT_NODE_PROVIDERS)[number];

/** Runtime guard for the provider set — the type alone carries no runtime members. */
export function isInstantNodeProvider(value: unknown): value is TInstantNodeProvider {
  return typeof value === 'string' && (INSTANT_NODE_PROVIDERS as readonly string[]).includes(value);
}

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
  readonly provider?: TInstantNodeProvider;
  readonly model?: string;
}

const PromptBackedConfigSchema = z.object({
  model: z.string().optional(),
});

const PROVIDER_DEFAULTS: Record<TInstantNodeProvider, { model: string; envVar: string }> = {
  anthropic: { model: 'claude-sonnet-4-6', envVar: 'ANTHROPIC_API_KEY' },
  openai: { model: 'gpt-4o-mini', envVar: 'OPENAI_API_KEY' },
  gemini: { model: 'gemini-2.0-flash', envVar: 'GEMINI_API_KEY' },
  deepseek: { model: 'deepseek-chat', envVar: 'DEEPSEEK_API_KEY' },
  qwen: { model: 'qwen-turbo', envVar: 'DASHSCOPE_API_KEY' },
};

function renderTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [key, value]) => t.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function resolveProviderInstance(
  provider: TInstantNodeProvider,
  model: string,
): { agent: Robota } | { error: IDagError } {
  const defaults = PROVIDER_DEFAULTS[provider];
  const apiKey = process.env[defaults.envVar];
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    const alternativeProviders = Object.entries(PROVIDER_DEFAULTS)
      .filter(
        ([p]) => p !== provider && process.env[PROVIDER_DEFAULTS[p as TInstantNodeProvider].envVar],
      )
      .map(([p]) => p);
    return {
      error: buildValidationError(
        'DAG_VALIDATION_INSTANT_NODE_API_KEY_REQUIRED',
        `${defaults.envVar} is required for instant node provider "${provider}" but is not set`,
        { provider, envVar: defaults.envVar },
        {
          action: 'add_api_key',
          suggestion: `Set ${defaults.envVar} in your environment or .env file`,
          options:
            alternativeProviders.length > 0
              ? alternativeProviders.map((p) => `Use provider "${p}" instead (API key already set)`)
              : [`Set ${defaults.envVar}=<your-api-key> in your environment`],
        },
      ),
    };
  }

  const agentName = `InstantNode_${provider}`;
  let agent: Robota;

  switch (provider) {
    case 'anthropic':
      agent = new Robota({
        name: agentName,
        aiProviders: [new AnthropicProvider({ apiKey: apiKey.trim() })],
        defaultModel: { provider: 'anthropic', model },
      });
      break;
    case 'openai':
      agent = new Robota({
        name: agentName,
        aiProviders: [new OpenAIProvider({ apiKey: apiKey.trim() })],
        defaultModel: { provider: 'openai', model },
      });
      break;
    case 'gemini':
      agent = new Robota({
        name: agentName,
        aiProviders: [new GoogleProvider({ apiKey: apiKey.trim() })],
        defaultModel: { provider: 'google', model },
      });
      break;
    case 'deepseek':
      agent = new Robota({
        name: agentName,
        aiProviders: [new DeepSeekProvider({ apiKey: apiKey.trim() })],
        defaultModel: { provider: 'deepseek', model },
      });
      break;
    case 'qwen':
      agent = new Robota({
        name: agentName,
        aiProviders: [new QwenProvider({ apiKey: apiKey.trim() })],
        defaultModel: { provider: 'qwen', model },
      });
      break;
  }

  return { agent };
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

  public constructor(spec: ICreatePromptNodeInput) {
    super();
    this.spec = spec;
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

    const provider: TInstantNodeProvider = this.spec.provider ?? 'anthropic';
    const defaults = PROVIDER_DEFAULTS[provider];
    const model = config.model ?? this.spec.model ?? defaults.model;

    const providerResult = resolveProviderInstance(provider, model);
    if ('error' in providerResult) {
      return { ok: false, error: providerResult.error };
    }

    const renderedPrompt = renderTemplate(this.spec.systemPromptTemplate, vars);

    try {
      // allow-fallback: catches provider API errors and converts to structured Result
      const completion = await providerResult.agent.run(renderedPrompt);
      io.setOutput(this.spec.outputPort.key, completion);
      const wordCount = typeof completion === 'string' ? completion.split(' ').length : 0;
      io.setOutput('_agentSummary', `Generated ${wordCount} words. Model: ${model}.`);
      return { ok: true, value: io.toOutput() };
    } catch (error) {
      // allow-fallback: catches provider API errors and converts to structured Result
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_LLM_GENERATION_FAILED',
          error instanceof Error ? error.message : 'LLM generation failed',
          true,
          { provider, model, nodeType: this.nodeType },
        ),
      };
    }
  }
}

export function createPromptBackedNodeDefinition(
  spec: ICreatePromptNodeInput,
): PromptBackedNodeDefinition {
  return new PromptBackedNodeDefinition(spec);
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
  readonly provider?: TInstantNodeProvider;
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
    const innerDag = asPersistedRecord(r['innerDag']);
    const exposedInputPort = asPersistedRecord(r['exposedInputPort']);
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
      innerDag: innerDag as unknown as IDagDefinition,
      exposedInputPort: exposedInputPort as unknown as IExposedInputPort,
      exposedOutputPorts: r['exposedOutputPorts'] as unknown as ReadonlyArray<IExposedOutputPort>,
      ...(typeof r['maxDepth'] === 'number' ? { maxDepth: r['maxDepth'] } : {}),
    };
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
    ...(isInstantNodeProvider(r['provider']) ? { provider: r['provider'] } : {}),
    ...(typeof r['model'] === 'string' ? { model: r['model'] } : {}),
  };
}

export interface IRehydrateInstantNodeDeps {
  /**
   * Sub-runner for a composite node — behavioral, never serialized, so it must be supplied on reload.
   * Required for `kind: 'composite'`; ignored for prompt nodes.
   */
  readonly compositeRunner?: ICompositeSubRunner;
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
