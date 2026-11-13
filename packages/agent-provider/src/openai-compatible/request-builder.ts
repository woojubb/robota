import { modelDeclaresCapability } from '@robota-sdk/agent-core';

import {
  convertToOpenAICompatibleMessages,
  convertToOpenAICompatibleTools,
} from './message-converter';
import { toOpenAICompatibleToolChoice } from './tool-choice';

import type {
  IChatOptions,
  IProviderCapabilityTable,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

/**
 * What the shared builder returns.
 *
 * `reasoning_effort` is omitted deliberately, not incidentally: the shared part decides no reasoning
 * effort, and deepseek re-declares that field with a narrower vocabulary of its own
 * (`TDeepSeekReasoningEffort`). Returning OpenAI's wider optional would make the spread into
 * deepseek's parameter type a type error for a field this function never sets.
 */
export type TSharedOpenAICompatibleRequestParams = Omit<
  OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  'reasoning_effort'
>;

/** Inputs the shared Chat-Completions request shape is derived from. */
export interface IOpenAICompatibleRequestInput {
  /** Conversation to send, in the universal message form. */
  messages: TUniversalMessage[];
  /** Per-call options; `undefined` when the caller passes none. */
  options: IChatOptions | undefined;
  /** Provider-level fallback used when `options.model` is absent. */
  defaultModel: string | undefined;
  /**
   * The calling provider's per-model capability table. `response_format` is emitted only for a
   * model that DECLARES the capability the request needs (`json_schema` for a schema request,
   * `json_object` or `json_schema` for a JSON-mode request), because the deployment targets this
   * family documents (`llms.txt`: any gateway, Azure, vLLM, Ollama, LM Studio) differ in whether an
   * unknown parameter is ignored or rejected. An absent table, or a model that declares nothing,
   * means no emission.
   */
  capabilityTable?: IProviderCapabilityTable;
}

/**
 * Build the Chat-Completions request fields every OpenAI-compatible sibling sends.
 *
 * This is the ONE place that decides what a compat request carries. It exists because deepseek,
 * qwen and gemma each held a private `buildRequestParams` with the same body, so a field added to
 * one of them reached the model on that provider only — and `IChatOptions.responseFormat` is the
 * field that was added to none of them. A per-provider extra (deepseek's
 * `thinking` / `reasoning_effort`) is spread onto the result by its own provider, so what lives
 * here stays the part that is genuinely shared.
 *
 * `validateTools` is deliberately NOT called here: it is a provider method, gemma does not call it,
 * and folding it in would change behaviour rather than preserve it.
 */
export function buildOpenAICompatibleRequestParams({
  messages,
  options,
  defaultModel,
  capabilityTable,
}: IOpenAICompatibleRequestInput): TSharedOpenAICompatibleRequestParams {
  const model = options?.model ?? defaultModel;
  if (!model) {
    throw new Error(
      'Model is required in chat options. Please specify a model in defaultModel configuration.',
    );
  }

  const requestParams = {
    model,
    messages: convertToOpenAICompatibleMessages(messages),
    ...(options?.temperature !== undefined && { temperature: options.temperature }),
    ...(options?.maxTokens !== undefined && { max_tokens: options.maxTokens }),
    ...(options?.tools && {
      tools: convertToOpenAICompatibleTools(options.tools),
      tool_choice: toOpenAICompatibleToolChoice(options.toolChoice),
    }),
    ...buildResponseFormat(options?.responseFormat, model, capabilityTable),
  };

  return requestParams as TSharedOpenAICompatibleRequestParams;
}

/**
 * The structured-output field of the request, gated on the capability the model DECLARES.
 *
 * - `json_schema` is sent, with its schema, only for a model that declares `json_schema`.
 * - `json_object` (JSON mode: the response parses, its shape is not enforced) is sent for a model
 *   that declares `json_object` or `json_schema`. DeepSeek declares only `json_object`, so a JSON
 *   mode request reaches it as `response_format: { type: 'json_object' }`. A schema request does
 *   not, because DeepSeek takes no schema parameter: the structured-output guard in `agent-core`
 *   turns it into a JSON mode request before it reaches the provider.
 * - `text` is sent only for a model that declares `json_schema`.
 *
 * Gated on the declaration rather than sent unconditionally because the documented deployment
 * targets include servers that reject unknown parameters. `modelDeclaresCapability` returns
 * `undefined` for silence (no table, or an unfilled list) and that is deliberately NOT treated as
 * permission.
 */
function buildResponseFormat(
  responseFormat: IChatOptions['responseFormat'],
  model: string,
  capabilityTable: IProviderCapabilityTable | undefined,
): { response_format?: OpenAI.Chat.ChatCompletionCreateParams['response_format'] } {
  if (!responseFormat) return {};
  const declaresSchema = modelDeclaresCapability(capabilityTable, model, 'json_schema') === true;
  const declaresJsonObject =
    modelDeclaresCapability(capabilityTable, model, 'json_object') === true;

  if (responseFormat.type === 'json_schema') {
    // allow-fallback: a model that does not DECLARE `json_schema` keeps the documented universal
    // contract — `agent-core`'s enforcement loop — rather than being sent a field its endpoint may
    // reject. The capability table is the explicit declaration that produces this branch.
    if (!declaresSchema) return {};
    return {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: responseFormat.name ?? 'structured_output',
          schema: responseFormat.schema as Record<string, unknown>,
        },
      },
    };
  }

  if (declaresSchema || (responseFormat.type === 'json_object' && declaresJsonObject)) {
    return { response_format: { type: responseFormat.type } };
  }
  // allow-fallback: a model that declares neither capability is not sent a field its endpoint may
  // reject; the table is the explicit declaration that produces this branch.
  return {};
}
