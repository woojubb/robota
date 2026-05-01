import type OpenAI from 'openai';
import type { IExecutor, ILogger, TProviderOptionValueBase } from '@robota-sdk/agent-core';

export type TQwenProviderOptionValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | OpenAI
  | ILogger
  | IExecutor
  | TProviderOptionValueBase
  | TQwenProviderOptionValue[]
  | { [key: string]: TQwenProviderOptionValue };

export interface IQwenProviderOptions {
  [key: string]: TQwenProviderOptionValue;

  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  defaultModel?: string;
  client?: OpenAI;
  executor?: IExecutor;
  logger?: ILogger;
}
