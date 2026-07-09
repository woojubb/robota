import type { IExecutor, ILogger, TProviderOptionValueBase } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

export type TGemmaProviderOptionValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | OpenAI
  | ILogger
  | IExecutor
  | TProviderOptionValueBase
  | TGemmaProviderOptionValue[]
  | { [key: string]: TGemmaProviderOptionValue };

export interface IGemmaProviderOptions {
  [key: string]: TGemmaProviderOptionValue;

  apiKey?: string;
  /**
   * API base URL of the OpenAI-compatible endpoint serving the model.
   * Works with gateways (LiteLLM, OpenRouter), vLLM, Ollama, LM Studio, or any
   * other chat-completions server; model ids are passed through verbatim.
   */
  baseURL?: string;
  timeout?: number;
  defaultModel?: string;
  client?: OpenAI;
  executor?: IExecutor;
  logger?: ILogger;
}
