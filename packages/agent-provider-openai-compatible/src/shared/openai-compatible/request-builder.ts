import {
  convertToOpenAICompatibleMessages,
  convertToOpenAICompatibleTools,
} from './message-converter';
import { toOpenAICompatibleToolChoice } from './tool-choice';

import type { IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';
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
}

/**
 * Build the Chat-Completions request fields every OpenAI-compatible sibling sends.
 *
 * This is the ONE place that decides what a compat request carries. It exists because deepseek,
 * qwen and gemma each held a private `buildRequestParams` with the same body, so a field added to
 * one of them reached the model on that provider only — and `IChatOptions.responseFormat` is the
 * field that was added to none of them (PROV-004, CORE-043). A per-provider extra (deepseek's
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
  };

  return requestParams as TSharedOpenAICompatibleRequestParams;
}
