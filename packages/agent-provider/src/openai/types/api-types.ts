import type OpenAI from 'openai';

/**
 * OpenAI API Request Parameters
 * Replaces any types with specific OpenAI API structure
 */
export interface IOpenAIChatRequestParams {
  model: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  temperature?: number | undefined;
  max_tokens?: number | undefined;
  tools?: OpenAI.Chat.ChatCompletionTool[] | undefined;
  tool_choice?: 'auto' | 'none' | OpenAI.Chat.ChatCompletionNamedToolChoice | undefined;
  stream?: boolean | undefined;
}

/**
 * OpenAI API streaming request parameters
 */
export interface IOpenAIStreamRequestParams extends Omit<IOpenAIChatRequestParams, 'stream'> {
  stream: true;
}

/**
 * OpenAI API tool call structure
 */
export interface IOpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * OpenAI API message structure with tool calls
 */
export interface IOpenAIAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: IOpenAIToolCall[];
}

/**
 * OpenAI API tool message structure
 */
export interface IOpenAIToolMessage {
  role: 'tool';
  content: string;
  tool_call_id: string;
}

/**
 * OpenAI streaming chunk delta structure
 */
export interface IOpenAIStreamDelta {
  role?: 'assistant';
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

/**
 * OpenAI streaming chunk structure
 */
export interface IOpenAIStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: IOpenAIStreamDelta;
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI error structure for type-safe error handling
 */
export interface IOpenAIError {
  message: string;
  type?: string;
  param?: string | null;
  code?: string | null;
}

/**
 * Payload logging data structure
 */
export interface IOpenAILogData {
  model: string;
  messagesCount: number;
  hasTools: boolean;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  timestamp: string;
  requestId?: string | undefined;
}
