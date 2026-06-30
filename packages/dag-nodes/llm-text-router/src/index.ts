import { z } from 'zod';
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
import { LlmTextAnthropicNodeDefinition } from '@robota-sdk/dag-node-llm-text-anthropic';
import { LlmTextOpenAiNodeDefinition } from '@robota-sdk/dag-node-llm-text-openai';
import { LlmTextGeminiNodeDefinition } from '@robota-sdk/dag-node-llm-text-gemini';
import { LlmTextDeepSeekNodeDefinition } from '@robota-sdk/dag-node-llm-text-deepseek';
import { LlmTextQwenNodeDefinition } from '@robota-sdk/dag-node-llm-text-qwen';

/** Supported LLM provider types for the router node. */
export type TRouterProviderType =
  | 'llm-text-anthropic'
  | 'llm-text-openai'
  | 'llm-text-gemini'
  | 'llm-text-deepseek'
  | 'llm-text-qwen';

const ProviderEntrySchema = z.object({
  type: z.enum([
    'llm-text-anthropic',
    'llm-text-openai',
    'llm-text-gemini',
    'llm-text-deepseek',
    'llm-text-qwen',
  ]),
  model: z.string().optional(),
  priority: z.number().int().positive().default(1),
});

const LlmTextRouterConfigSchema = z.object({
  providers: z.array(ProviderEntrySchema).min(1),
  strategy: z.enum(['priority-fallback', 'round-robin']).default('priority-fallback'),
  maxCostUsd: z.number().positive().optional(),
});

/** Env var names used to detect API key presence per provider. */
const PROVIDER_ENV_KEY_MAP: Record<TRouterProviderType, string> = {
  'llm-text-anthropic': 'ANTHROPIC_API_KEY',
  'llm-text-openai': 'OPENAI_API_KEY',
  'llm-text-gemini': 'GEMINI_API_KEY',
  'llm-text-deepseek': 'DEEPSEEK_API_KEY',
  'llm-text-qwen': 'DASHSCOPE_API_KEY',
};

function hasApiKey(providerType: TRouterProviderType): boolean {
  const envName = PROVIDER_ENV_KEY_MAP[providerType];
  const value = process.env[envName];
  return typeof value === 'string' && value.trim().length > 0;
}

function createProviderNodeDefinition(providerType: TRouterProviderType): IDagNodeDefinition {
  switch (providerType) {
    case 'llm-text-anthropic':
      return new LlmTextAnthropicNodeDefinition();
    case 'llm-text-openai':
      return new LlmTextOpenAiNodeDefinition();
    case 'llm-text-gemini':
      return new LlmTextGeminiNodeDefinition();
    case 'llm-text-deepseek':
      return new LlmTextDeepSeekNodeDefinition();
    case 'llm-text-qwen':
      return new LlmTextQwenNodeDefinition();
  }
}

/**
 * Builds a synthetic {@link INodeExecutionContext} for a delegate provider node.
 * The config override allows the router to forward per-provider model settings.
 */
function buildDelegateContext(
  context: INodeExecutionContext,
  providerNodeDef: IDagNodeDefinition,
  model: string | undefined,
): INodeExecutionContext {
  const baseConfig = context.nodeDefinition.config ?? {};
  const delegateConfig =
    typeof model === 'string' && model.trim().length > 0
      ? { ...baseConfig, model: model.trim() }
      : baseConfig;

  return {
    ...context,
    nodeDefinition: {
      ...context.nodeDefinition,
      nodeType: providerNodeDef.nodeType,
      config: delegateConfig,
    },
  };
}

function buildRouterAgentSummary(
  usedProvider: TRouterProviderType,
  attempted: readonly TRouterProviderType[],
  delegateSummary: string | undefined,
): string {
  const fallbackLabel =
    attempted.length > 1 ? ` (fallback from ${attempted.slice(0, -1).join(', ')})` : '';
  const suffix =
    typeof delegateSummary === 'string' && delegateSummary.trim().length > 0
      ? ` — ${delegateSummary}`
      : '';
  return `Used: ${usedProvider}${fallbackLabel}${suffix}`;
}

/**
 * DAG node that routes LLM text generation across multiple providers using a
 * priority-fallback strategy. Providers are tried in ascending priority order;
 * a provider is skipped if its API key env var is absent, or if execution fails.
 * The first successful response is returned.
 *
 * Supports providers: anthropic, openai, gemini, deepseek, qwen.
 */
export class LlmTextRouterNodeDefinition extends AbstractNodeDefinition<
  typeof LlmTextRouterConfigSchema
> {
  public readonly nodeType = 'llm-text-router';
  public readonly displayName = 'LLM Text Router';
  public readonly category = 'AI';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'text';
  public readonly configSchemaDefinition = LlmTextRouterConfigSchema;

  protected override async validateInputWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    _config: z.output<typeof LlmTextRouterConfigSchema>,
  ): Promise<TResult<void, IDagError>> {
    if (typeof input.text !== 'string' || input.text.trim().length === 0) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_LLM_PROMPT_REQUIRED',
          'LLM router node requires a non-empty text input',
          { nodeId: context.nodeDefinition.nodeId },
        ),
      };
    }
    return { ok: true, value: undefined };
  }

  public override async estimateCostWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    _config: z.output<typeof LlmTextRouterConfigSchema>,
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
    const CHARS_PER_TOKEN_ESTIMATE = 4;
    const COST_PER_TOKEN_USD = 0.003;
    const estimatedCredits = (text.length / CHARS_PER_TOKEN_ESTIMATE) * COST_PER_TOKEN_USD;
    return { ok: true, value: { estimatedCredits } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof LlmTextRouterConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const textResult = io.requireInputString('text');
    if (!textResult.ok || textResult.value.trim().length === 0) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_LLM_PROMPT_REQUIRED',
          'LLM router node requires a non-empty text input',
          { nodeId: context.nodeDefinition.nodeId },
        ),
      };
    }

    // Sort providers by priority (ascending = lower number tried first)
    const sortedProviders = [...config.providers].sort((a, b) => a.priority - b.priority);

    const attempted: TRouterProviderType[] = [];
    const skipped: TRouterProviderType[] = [];
    let lastError: IDagError | undefined;

    for (const entry of sortedProviders) {
      const providerType = entry.type as TRouterProviderType;

      if (!hasApiKey(providerType)) {
        skipped.push(providerType);
        continue;
      }

      attempted.push(providerType);
      const providerNode = createProviderNodeDefinition(providerType);
      const delegateContext = buildDelegateContext(context, providerNode, entry.model);

      const result = await providerNode.taskHandler.execute(input, delegateContext); // allow-fallback: router tries next provider on failure
      if (result.ok) {
        const delegateSummary =
          typeof result.value['_agentSummary'] === 'string'
            ? result.value['_agentSummary']
            : undefined;
        return {
          ok: true,
          value: {
            ...result.value,
            _agentSummary: buildRouterAgentSummary(providerType, attempted, delegateSummary),
          },
        };
      }
      lastError = result.error;
    }

    // All providers failed or were skipped
    if (attempted.length === 0) {
      const skippedList = skipped.join(', ');
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_ROUTER_NO_API_KEY_AVAILABLE',
          [
            'No configured LLM provider has an API key set.',
            `Skipped (missing API key): ${skippedList || 'none'}`,
            'Set at least one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY, DASHSCOPE_API_KEY',
          ].join('\n'),
          { skipped: skippedList },
          { action: 'set_env_var', suggestion: 'export ANTHROPIC_API_KEY=sk-ant-...' },
        ),
      };
    }

    return {
      ok: false,
      error:
        lastError ??
        buildTaskExecutionError(
          'DAG_TASK_EXECUTION_LLM_GENERATION_FAILED',
          'All configured LLM providers failed',
          true,
          { attempted: attempted.join(', '), skipped: skipped.join(', ') },
        ),
    };
  }
}
