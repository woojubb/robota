import type OpenAI from 'openai';
import type { IExecutor, ILogger, TProviderOptionValueBase } from '@robota-sdk/agent-core';

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
  baseURL?: string;
  timeout?: number;
  defaultModel?: string;
  client?: OpenAI;
  executor?: IExecutor;
  logger?: ILogger;
}
