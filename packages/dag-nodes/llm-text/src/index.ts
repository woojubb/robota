import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
import {
  buildTaskExecutionError,
  buildValidationError,
  type ICostEstimate,
  type IDagError,
  type IDagNodeDefinition,
  type INodeExecutionContext,
  type TResult,
  type TPortPayload,
} from '@robota-sdk/dag-core';
import {
  Robota,
  createProviderFromConfig,
  findProviderDefinition,
  getProviderCredentialRequirement,
  normalizeProviderConfig,
  type IProviderDefinition,
  type IProviderDefinitionConfig,
  type TUniversalValue,
} from '@robota-sdk/agent-core';

import {
  buildAgentSummary,
  CHARS_PER_TOKEN_ESTIMATE,
  FALLBACK_COST_PER_TOKEN_USD,
  formatSkips,
  LlmTextConfigSchema,
  type IResolvedEntry,
  type ISkip,
  type TLlmTextConfig,
} from './config.js';
import { classifyLlmError, sanitizeErrorMessage } from './llm-errors.js';

/** The outcome of trying one provider entry: a usable provider config, or a skip reason. */
type TEntryPrep = { config: IProviderDefinitionConfig } | { skip: ISkip['reason'] };

/**
 * Collapsed, provider-registry-driven LLM text node (ARCH-PROVIDER-003). Supersedes the five per-vendor
 * `llm-text-<vendor>` nodes and the `llm-text-router`. The node is constructed with an injected
 * {@link IProviderDefinition} registry and resolves the target `IAIProvider` through
 * {@link normalizeProviderConfig} + {@link createProviderFromConfig} — so it reads **no** `process.env`
 * itself (credential/`$ENV:` resolution lives in `agent-core`). Providers are tried in ascending priority
 * order; a provider with no resolvable credential is **skipped** (an `allow-fallback: try-next-provider`
 * strategy), and the first success is returned.
 */
export class LlmTextNodeDefinition extends AbstractNodeDefinition<typeof LlmTextConfigSchema> {
  public readonly nodeType = 'llm-text';
  public readonly displayName = 'LLM Text';
  public readonly category = 'AI';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'text';
  public readonly configSchemaDefinition = LlmTextConfigSchema;

  private readonly providers: readonly IProviderDefinition[];

  public constructor(providers: readonly IProviderDefinition[]) {
    super();
    this.providers = providers;
  }

  /** Resolve the ordered provider list from config: single-provider shorthand or the routing array. */
  private resolveEntries(config: TLlmTextConfig): TResult<IResolvedEntry[], IDagError> {
    if (Array.isArray(config.providers) && config.providers.length > 0) {
      return { ok: true, value: [...config.providers].sort((a, b) => a.priority - b.priority) };
    }
    if (typeof config.provider === 'string' && config.provider.trim().length > 0) {
      return {
        ok: true,
        value: [{ provider: config.provider.trim(), model: config.model, priority: 1 }],
      };
    }
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_LLM_PROVIDER_REQUIRED',
        'llm-text node requires either `provider` (single) or a non-empty `providers` list',
        {},
      ),
    };
  }

  /** Normalize one entry to a resolved provider config, or report why it must be skipped. */
  private prepareEntry(
    entry: IResolvedEntry,
    config: TLlmTextConfig,
    definition: IProviderDefinition,
  ): TEntryPrep {
    let normalized: IProviderDefinitionConfig;
    try {
      normalized = normalizeProviderConfig(
        {
          name: entry.provider,
          model: entry.model ?? config.model,
          ...(config.options !== undefined && {
            options: config.options as Record<string, TUniversalValue>,
          }),
        },
        this.providers,
      );
    } catch {
      // allow-fallback: a provider with no resolvable model is skipped, not fatal to the whole node.
      return { skip: 'no-model' };
    }
    if (!this.hasCredential(definition, normalized)) {
      return { skip: 'no-credential' };
    }
    if (
      definition.allowedModels !== undefined &&
      definition.allowedModels.length > 0 &&
      !definition.allowedModels.includes(normalized.model)
    ) {
      return { skip: 'model-not-allowed' };
    }
    return { config: normalized };
  }

  private hasCredential(
    definition: IProviderDefinition,
    config: IProviderDefinitionConfig,
  ): boolean {
    const requirement = getProviderCredentialRequirement(definition);
    if (requirement === undefined) {
      return true;
    }
    return requirement.anyOf.some((field) => {
      const value = config[field];
      return typeof value === 'string' && value.length > 0;
    });
  }

  private async runProvider(
    providerConfig: IProviderDefinitionConfig,
    config: TLlmTextConfig,
    prompt: string,
  ): Promise<string> {
    const provider = createProviderFromConfig(providerConfig, this.providers);
    const agent = new Robota({
      name: 'DagLlmTextNodeAgent',
      aiProviders: [provider],
      defaultModel: {
        provider: provider.name,
        model: providerConfig.model,
        ...(typeof config.temperature === 'number' && { temperature: config.temperature }),
        ...(typeof config.maxTokens === 'number' && { maxTokens: config.maxTokens }),
      },
    });
    return agent.run(prompt);
  }

  protected override async validateInputWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: TLlmTextConfig,
  ): Promise<TResult<void, IDagError>> {
    if (typeof input.text !== 'string' || input.text.trim().length === 0) {
      return { ok: false, error: this.promptRequiredError(context) };
    }
    const entriesResult = this.resolveEntries(config);
    if (!entriesResult.ok) {
      return entriesResult;
    }
    return { ok: true, value: undefined };
  }

  public override async estimateCostWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: TLlmTextConfig,
  ): Promise<TResult<ICostEstimate, IDagError>> {
    const text = input.text;
    if (typeof text !== 'string') {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_LLM_PROMPT_INVALID',
          'text must be string for cost estimation',
          { nodeId: context.nodeDefinition.nodeId },
        ),
      };
    }
    const entriesResult = this.resolveEntries(config);
    const primary = entriesResult.ok ? entriesResult.value[0] : undefined;
    const definition =
      primary !== undefined ? findProviderDefinition(this.providers, primary.provider) : undefined;
    const costPerToken = definition?.costPerTokenUsd ?? FALLBACK_COST_PER_TOKEN_USD;
    const estimatedCredits =
      config.baseCredits + (text.length / CHARS_PER_TOKEN_ESTIMATE) * costPerToken;
    return { ok: true, value: { estimatedCredits } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: TLlmTextConfig,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const textResult = io.requireInputString('text');
    if (!textResult.ok || textResult.value.trim().length === 0) {
      return { ok: false, error: this.promptRequiredError(context) };
    }
    const entriesResult = this.resolveEntries(config);
    if (!entriesResult.ok) {
      return entriesResult;
    }

    const attempted: string[] = [];
    const skipped: ISkip[] = [];
    let lastError: IDagError | undefined;

    for (const entry of entriesResult.value) {
      const definition = findProviderDefinition(this.providers, entry.provider);
      if (definition === undefined) {
        skipped.push({ provider: entry.provider, reason: 'unknown-provider' });
        continue;
      }
      const prep = this.prepareEntry(entry, config, definition);
      if ('skip' in prep) {
        skipped.push({ provider: entry.provider, reason: prep.skip });
        continue;
      }

      attempted.push(entry.provider);
      try {
        const completion = await this.runProvider(prep.config, config, textResult.value);
        io.setOutput('text', completion);
        const wordCount = typeof completion === 'string' ? completion.split(' ').length : 0;
        io.setOutput(
          '_agentSummary',
          buildAgentSummary(entry.provider, prep.config.model, attempted, wordCount),
        );
        return { ok: true, value: io.toOutput() };
      } catch (error) {
        // allow-fallback: provider API errors are captured and the next provider is tried.
        const { code, retryable } = classifyLlmError(error);
        const rawMessage = error instanceof Error ? error.message : 'LLM generation failed';
        lastError = buildTaskExecutionError(
          'DAG_TASK_EXECUTION_LLM_GENERATION_FAILED',
          sanitizeErrorMessage(rawMessage),
          retryable,
          { provider: entry.provider, model: prep.config.model, errorCode: code },
        );
      }
    }

    return { ok: false, error: this.noSuccessError(attempted, skipped, lastError) };
  }

  private promptRequiredError(context: INodeExecutionContext): IDagError {
    return buildValidationError(
      'DAG_VALIDATION_LLM_PROMPT_REQUIRED',
      'LLM node requires a non-empty text input',
      { nodeId: context.nodeDefinition.nodeId },
    );
  }

  private noSuccessError(
    attempted: readonly string[],
    skipped: readonly ISkip[],
    lastError: IDagError | undefined,
  ): IDagError {
    if (attempted.length === 0) {
      return buildValidationError(
        'DAG_VALIDATION_LLM_NO_PROVIDER_AVAILABLE',
        [
          'No configured LLM provider is usable.',
          `Skipped: ${formatSkips(skipped) || 'none'}`,
          'Ensure at least one provider has its API key set (e.g. OPENAI_API_KEY / ANTHROPIC_API_KEY).',
        ].join('\n'),
        { skipped: formatSkips(skipped) },
        { action: 'set_env_var', suggestion: 'export OPENAI_API_KEY=sk-...' },
      );
    }
    return (
      lastError ??
      buildTaskExecutionError(
        'DAG_TASK_EXECUTION_LLM_GENERATION_FAILED',
        'All configured LLM providers failed',
        true,
        { attempted: attempted.join(', '), skipped: formatSkips(skipped) },
      )
    );
  }
}
