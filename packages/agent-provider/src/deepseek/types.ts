import type { IExecutor, ILogger, TProviderOptionValueBase } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

export type TDeepSeekThinkingMode = 'enabled' | 'disabled';
export type TDeepSeekReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface IDeepSeekThinkingConfig {
  type: TDeepSeekThinkingMode;
}

export type TDeepSeekProviderOptionValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | IDeepSeekThinkingConfig
  | OpenAI
  | ILogger
  | IExecutor
  | TProviderOptionValueBase
  | TDeepSeekProviderOptionValue[]
  | { [key: string]: TDeepSeekProviderOptionValue };

export interface IDeepSeekProviderOptions {
  [key: string]: TDeepSeekProviderOptionValue;

  apiKey?: string;
  /**
   * API base URL (default: DeepSeek's OpenAI-compatible endpoint).
   * Any OpenAI-compatible server works — gateways (LiteLLM, OpenRouter), vLLM,
   * Ollama, LM Studio; model ids are passed through verbatim.
   */
  baseURL?: string;
  timeout?: number;
  defaultModel?: string;
  thinking?: TDeepSeekThinkingMode;
  reasoningEffort?: TDeepSeekReasoningEffort;
  client?: OpenAI;
  executor?: IExecutor;
  logger?: ILogger;
}
