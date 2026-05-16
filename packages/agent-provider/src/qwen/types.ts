import type OpenAI from 'openai';
import type {
  IExecutor,
  ILogger,
  IToolSchema,
  TProviderOptionValueBase,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

export type TQwenBuiltInWebToolName = 'web_search' | 'web_extractor';

export interface IQwenBuiltInWebToolsOptions {
  webSearch?: boolean;
  webFetch?: boolean;
  enableThinking?: boolean;
}

export interface IQwenResponsesWebSearchTool {
  type: 'web_search';
}

export interface IQwenResponsesWebExtractorTool {
  type: 'web_extractor';
}

export interface IQwenResponsesFunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters: IToolSchema['parameters'];
}

export type TQwenResponsesTool =
  | IQwenResponsesWebSearchTool
  | IQwenResponsesWebExtractorTool
  | IQwenResponsesFunctionTool;

export interface IQwenResponsesMessageInput {
  type?: 'message';
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: string;
}

export interface IQwenResponsesFunctionCallInput {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

export interface IQwenResponsesFunctionCallOutputInput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

export type TQwenResponsesInputItem =
  | IQwenResponsesMessageInput
  | IQwenResponsesFunctionCallInput
  | IQwenResponsesFunctionCallOutputInput;

export interface IQwenResponsesRequestBase {
  model: string;
  input: TQwenResponsesInputItem[];
  tools?: TQwenResponsesTool[];
  temperature?: number;
  max_output_tokens?: number;
  enable_thinking?: boolean;
}

export interface IQwenResponsesRequestNonStreaming extends IQwenResponsesRequestBase {
  stream?: false;
}

export interface IQwenResponsesRequestStreaming extends IQwenResponsesRequestBase {
  stream: true;
}

export interface IQwenResponsesTextContent {
  type: 'output_text' | 'text' | 'input_text';
  text: string;
}

export interface IQwenResponsesMessageOutputItem {
  type: 'message';
  content: IQwenResponsesTextContent[];
}

export interface IQwenResponsesFunctionCallOutputItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
  id?: string;
  status?: string;
}

export interface IQwenResponsesWebSearchAction {
  query?: string;
}

export interface IQwenResponsesWebSearchOutputItem {
  type: 'web_search_call';
  id?: string;
  status?: string;
  action?: IQwenResponsesWebSearchAction;
}

export interface IQwenResponsesWebExtractorOutputItem {
  type: 'web_extractor_call';
  id?: string;
  status?: string;
  goal?: string;
  output?: string;
}

export interface IQwenResponsesGenericOutputItem {
  type: string;
  id?: string;
  status?: string;
}

export type TQwenResponsesOutputItem =
  | IQwenResponsesMessageOutputItem
  | IQwenResponsesFunctionCallOutputItem
  | IQwenResponsesWebSearchOutputItem
  | IQwenResponsesWebExtractorOutputItem
  | IQwenResponsesGenericOutputItem;

export interface IQwenResponsesToolUsageCount {
  count?: number;
}

export interface IQwenResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  x_tools?: Record<string, IQwenResponsesToolUsageCount>;
}

export interface IQwenResponsesResponse {
  id?: string;
  model?: string;
  output_text?: string;
  output?: TQwenResponsesOutputItem[];
  usage?: IQwenResponsesUsage;
  status?: string;
}

export interface IQwenResponsesTextDeltaEvent {
  type: 'response.output_text.delta';
  delta: string;
}

export interface IQwenResponsesCompletedEvent {
  type: 'response.completed';
  response: IQwenResponsesResponse;
}

export interface IQwenResponsesOutputItemDoneEvent {
  type: 'response.output_item.done';
  item: TQwenResponsesOutputItem;
}

export interface IQwenResponsesErrorEvent {
  type: 'response.error' | 'response.failed';
  message?: string;
  error?: {
    message?: string;
  };
  response?: {
    error?: {
      message?: string;
    };
  };
}

export interface IQwenResponsesWebSearchEvent {
  type:
    | 'response.web_search_call.in_progress'
    | 'response.web_search_call.searching'
    | 'response.web_search_call.completed';
}

export interface IQwenResponsesGenericEvent {
  type: string;
  item?: TQwenResponsesOutputItem;
  response?: IQwenResponsesResponse;
}

export type TQwenResponsesStreamEvent =
  | IQwenResponsesTextDeltaEvent
  | IQwenResponsesCompletedEvent
  | IQwenResponsesOutputItemDoneEvent
  | IQwenResponsesErrorEvent
  | IQwenResponsesWebSearchEvent;

export type TQwenMessagesToResponsesInput = (
  messages: TUniversalMessage[],
) => TQwenResponsesInputItem[];

export type TQwenProviderOptionValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | IQwenBuiltInWebToolsOptions
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
  responsesBaseURL?: string;
  timeout?: number;
  defaultModel?: string;
  builtInWebTools?: IQwenBuiltInWebToolsOptions;
  client?: OpenAI;
  executor?: IExecutor;
  logger?: ILogger;
}
