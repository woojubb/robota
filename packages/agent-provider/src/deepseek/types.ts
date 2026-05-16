import type OpenAI from 'openai';
import type { IExecutor, ILogger, TProviderOptionValueBase } from '@robota-sdk/agent-core';

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
  baseURL?: string;
  timeout?: number;
  defaultModel?: string;
  thinking?: TDeepSeekThinkingMode;
  reasoningEffort?: TDeepSeekReasoningEffort;
  client?: OpenAI;
  executor?: IExecutor;
  logger?: ILogger;
}
