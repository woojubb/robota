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
import { Robota } from '@robota-sdk/agent-core';
import { GoogleProvider } from '@robota-sdk/agent-provider-google';
import { z } from 'zod';

const DEFAULT_GEMINI_LLM_MODEL = 'gemini-2.0-flash';
const DEFAULT_TEMPERATURE = 0.2;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const COST_PER_TOKEN_USD = 0.0005;

const API_KEY_PATTERN = /\b(sk-[A-Za-z0-9\-_]{10,}|[A-Za-z0-9]{32,})\b/g;

function sanitizeErrorMessage(message: string): string {
  return message.replace(API_KEY_PATTERN, '[REDACTED]');
}

type TLlmErrorCode =
  | 'MISSING_API_KEY'
  | 'RATE_LIMITED'
  | 'CONTEXT_TOO_LONG'
  | 'BILLING_ERROR'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

function classifyLlmError(error: unknown): { code: TLlmErrorCode; retryable: boolean } {
  const status =
    (error as { status?: number })?.status ?? (error as { statusCode?: number })?.statusCode;
  const message = ((error as { message?: string })?.message ?? '').toLowerCase();

  if (
    status === 401 ||
    message.includes('authentication') ||
    message.includes('api_key') ||
    message.includes('invalid key')
  ) {
    return { code: 'MISSING_API_KEY', retryable: false };
  }
  if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
    return { code: 'RATE_LIMITED', retryable: true };
  }
  if (
    message.includes('context_length_exceeded') ||
    message.includes('too long') ||
    message.includes('maximum context')
  ) {
    return { code: 'CONTEXT_TOO_LONG', retryable: false };
  }
  if (status === 402 || message.includes('billing') || message.includes('quota')) {
    return { code: 'BILLING_ERROR', retryable: false };
  }
  if (status !== undefined && status >= 500) {
    return { code: 'SERVER_ERROR', retryable: true };
  }
  return { code: 'UNKNOWN', retryable: false };
}

const LlmTextGeminiConfigSchema = z.object({
  model: z.string().default(DEFAULT_GEMINI_LLM_MODEL),
  temperature: z.number().default(DEFAULT_TEMPERATURE),
  maxTokens: z.number().int().positive().optional(),
  baseCredits: z.number().default(0),
});

export interface ILlmTextGeminiNodeDefinitionOptions {
  defaultModel?: string;
  allowedModels?: string[];
}

export class LlmTextGeminiNodeDefinition extends AbstractNodeDefinition<
  typeof LlmTextGeminiConfigSchema
> {
  public readonly nodeType = 'llm-text-gemini';
  public readonly displayName = 'LLM Text Gemini';
  public readonly category = 'AI';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'text';
  public readonly configSchemaDefinition = LlmTextGeminiConfigSchema;

  private readonly apiKeyEnvName = 'GEMINI_API_KEY';
  private readonly defaultModel: string;
  private readonly allowedModels: string[];

  public constructor(options?: ILlmTextGeminiNodeDefinitionOptions) {
    super();
    this.defaultModel =
      typeof options?.defaultModel === 'string' && options.defaultModel.trim().length > 0
        ? options.defaultModel.trim()
        : DEFAULT_GEMINI_LLM_MODEL;
    this.allowedModels =
      Array.isArray(options?.allowedModels) && options.allowedModels.length > 0
        ? options.allowedModels
        : [this.defaultModel];
  }

  private resolveProvider(): GoogleProvider | undefined {
    const apiKey = process.env[this.apiKeyEnvName];
    if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
      return new GoogleProvider({ apiKey: apiKey.trim() });
    }
    return undefined;
  }

  private resolveModel(modelFromConfig: string): TResult<string, IDagError> {
    const selectedModel =
      modelFromConfig.trim().length > 0 ? modelFromConfig.trim() : this.defaultModel;
    if (this.allowedModels.length > 0 && !this.allowedModels.includes(selectedModel)) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_LLM_MODEL_NOT_ALLOWED',
          'Selected model is not allowed for llm-text-gemini node',
          { model: selectedModel },
        ),
      };
    }
    return { ok: true, value: selectedModel };
  }

  protected override async validateInputWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof LlmTextGeminiConfigSchema>,
  ): Promise<TResult<void, IDagError>> {
    if (typeof input.text !== 'string' || input.text.trim().length === 0) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_LLM_PROMPT_REQUIRED',
          'LLM node requires a non-empty text input',
          { nodeId: context.nodeDefinition.nodeId },
        ),
      };
    }
    const modelResult = this.resolveModel(config.model);
    if (!modelResult.ok) {
      return modelResult;
    }
    return { ok: true, value: undefined };
  }

  public override async estimateCostWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof LlmTextGeminiConfigSchema>,
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
    const estimatedCredits =
      config.baseCredits + (text.length / CHARS_PER_TOKEN_ESTIMATE) * COST_PER_TOKEN_USD;
    return { ok: true, value: { estimatedCredits } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof LlmTextGeminiConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const provider = this.resolveProvider();
    if (!provider) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_GEMINI_API_KEY_REQUIRED',
          [
            'GEMINI_API_KEY is not set.',
            "Fix: echo 'GEMINI_API_KEY=AIza...' >> .env",
            'Then: dag run <file> --env-file .env',
            'Get key: https://makersuite.google.com/app/apikey',
          ].join('\n'),
          {},
          { action: 'set_env_var', suggestion: 'export GEMINI_API_KEY=AIza...' },
        ),
      };
    }
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const textResult = io.requireInputString('text');
    if (!textResult.ok || textResult.value.trim().length === 0) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_LLM_PROMPT_REQUIRED',
          'LLM node requires a non-empty text input',
          { nodeId: context.nodeDefinition.nodeId },
        ),
      };
    }
    const modelResult = this.resolveModel(config.model);
    if (!modelResult.ok) {
      return modelResult;
    }

    const agent = new Robota({
      name: 'DagLlmTextGeminiNodeAgent',
      aiProviders: [provider],
      defaultModel: {
        provider: 'google',
        model: modelResult.value,
        ...(typeof config.temperature === 'number' ? { temperature: config.temperature } : {}),
        ...(typeof config.maxTokens === 'number' ? { maxTokens: config.maxTokens } : {}),
      },
    });

    try {
      const completion = await agent.run(textResult.value);
      io.setOutput('text', completion);
      const wordCount = typeof completion === 'string' ? completion.split(' ').length : 0;
      io.setOutput('_agentSummary', `Generated ${wordCount} words. Model: ${modelResult.value}.`);
      return { ok: true, value: io.toOutput() };
    } catch (error) {
      // allow-fallback: catches provider API errors and converts to structured Result
      const { code, retryable } = classifyLlmError(error);
      const rawMessage = error instanceof Error ? error.message : 'LLM generation failed';
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_LLM_GENERATION_FAILED',
          sanitizeErrorMessage(rawMessage),
          retryable,
          { provider: 'google', model: modelResult.value, errorCode: code },
        ),
      };
    }
  }
}
