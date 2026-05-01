import type OpenAI from 'openai';
import type { TTextDeltaCallback } from '@robota-sdk/agent-core';

export interface IOpenAICompatibleChatRequestParams {
  model: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  temperature?: number | undefined;
  max_tokens?: number | undefined;
  tools?: OpenAI.Chat.ChatCompletionTool[] | undefined;
  tool_choice?: 'auto' | 'none' | OpenAI.Chat.ChatCompletionNamedToolChoice | undefined;
  stream?: boolean | undefined;
}

export interface IOpenAICompatibleStreamRequestParams
  extends Omit<IOpenAICompatibleChatRequestParams, 'stream'> {
  stream: true;
}

export interface IOpenAICompatibleError {
  message: string;
  type?: string;
  param?: string | null;
  code?: string | null;
}

export interface IOpenAICompatibleLogData {
  model: string;
  messagesCount: number;
  hasTools: boolean;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  timestamp: string;
  requestId?: string | undefined;
}

export type TOpenAICompatibleTextProjector = (text: string) => string;
export type TOpenAICompatibleTextProjectorFlush = () => string;

export interface IOpenAICompatibleStreamAssemblyOptions {
  stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
  onTextDelta?: TTextDeltaCallback;
  signal?: AbortSignal;
  textProjector?: TOpenAICompatibleTextProjector;
  textProjectorFlush?: TOpenAICompatibleTextProjectorFlush;
  metadata?: Record<string, string | number | boolean>;
}
