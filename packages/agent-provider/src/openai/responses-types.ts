import type { IToolSchema } from '@robota-sdk/agent-core';
import type {
  IOpenAIJsonSchemaDefinition,
  IOpenAIResponsesReasoningOptions,
  TOpenAIProviderOptionValue,
} from './types';

export type TOpenAIResponsesInputRole = 'user' | 'assistant' | 'system' | 'developer';

export interface IOpenAIResponsesInputTextContent {
  type: 'input_text';
  text: string;
}

export interface IOpenAIResponsesInputImageContent {
  type: 'input_image';
  image_url: string;
  detail?: 'auto' | 'low' | 'high';
}

export type TOpenAIResponsesInputContent =
  | IOpenAIResponsesInputTextContent
  | IOpenAIResponsesInputImageContent;

export interface IOpenAIResponsesMessageInput {
  type?: 'message';
  role: TOpenAIResponsesInputRole;
  content: string | TOpenAIResponsesInputContent[];
}

export interface IOpenAIResponsesFunctionCallInput {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

export interface IOpenAIResponsesFunctionCallOutputInput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

export type TOpenAIResponsesInputItem =
  | IOpenAIResponsesMessageInput
  | IOpenAIResponsesFunctionCallInput
  | IOpenAIResponsesFunctionCallOutputInput;

export interface IOpenAIResponsesFunctionTool {
  type: 'function';
  name: string;
  parameters: IToolSchema['parameters'];
  strict: boolean | null;
  description?: string;
}

export type TOpenAIResponsesTool = IOpenAIResponsesFunctionTool;

export interface IOpenAIResponsesTextFormatText {
  type: 'text';
}

export interface IOpenAIResponsesTextFormatJsonObject {
  type: 'json_object';
}

export interface IOpenAIResponsesTextFormatJsonSchema extends IOpenAIJsonSchemaDefinition {
  type: 'json_schema';
  schema: Record<string, TOpenAIProviderOptionValue>;
}

export type TOpenAIResponsesTextFormat =
  | IOpenAIResponsesTextFormatText
  | IOpenAIResponsesTextFormatJsonObject
  | IOpenAIResponsesTextFormatJsonSchema;

export interface IOpenAIResponsesTextConfig {
  format: TOpenAIResponsesTextFormat;
}

export interface IOpenAIResponsesRequestBase {
  model: string;
  input: TOpenAIResponsesInputItem[];
  tools?: TOpenAIResponsesTool[];
  tool_choice?: 'auto' | 'none' | 'required';
  text?: IOpenAIResponsesTextConfig;
  temperature?: number;
  max_output_tokens?: number;
  reasoning?: IOpenAIResponsesReasoningOptions;
  include?: 'reasoning.encrypted_content'[];
  store?: boolean;
}

export interface IOpenAIResponsesRequestNonStreaming extends IOpenAIResponsesRequestBase {
  stream?: false;
}

export interface IOpenAIResponsesRequestStreaming extends IOpenAIResponsesRequestBase {
  stream: true;
}

export interface IOpenAIResponsesTextOutputContent {
  type: 'output_text' | 'text';
  text: string;
}

export interface IOpenAIResponsesRefusalOutputContent {
  type: 'refusal';
  refusal: string;
}

export type TOpenAIResponsesOutputContent =
  | IOpenAIResponsesTextOutputContent
  | IOpenAIResponsesRefusalOutputContent;

export interface IOpenAIResponsesMessageOutputItem {
  type: 'message';
  role?: 'assistant';
  content: TOpenAIResponsesOutputContent[];
}

export interface IOpenAIResponsesFunctionCallOutputItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
  id?: string;
  status?: string;
}

export interface IOpenAIResponsesReasoningOutputItem {
  type: 'reasoning';
  summary?: Array<{ text?: string }>;
  encrypted_content?: string;
}

export interface IOpenAIResponsesGenericOutputItem {
  type: string;
  id?: string;
  status?: string;
}

export type TOpenAIResponsesOutputItem =
  | IOpenAIResponsesMessageOutputItem
  | IOpenAIResponsesFunctionCallOutputItem
  | IOpenAIResponsesReasoningOutputItem
  | IOpenAIResponsesGenericOutputItem;

export interface IOpenAIResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface IOpenAIResponsesErrorBody {
  message?: string;
}

export interface IOpenAIResponsesResponse {
  id?: string;
  model?: string;
  output_text?: string;
  output?: TOpenAIResponsesOutputItem[];
  usage?: IOpenAIResponsesUsage;
  status?: string;
  error?: IOpenAIResponsesErrorBody | null;
}

export interface IOpenAIResponsesTextDeltaEvent {
  type: 'response.output_text.delta';
  delta: string;
}

export interface IOpenAIResponsesCompletedEvent {
  type: 'response.completed';
  response: IOpenAIResponsesResponse;
}

export interface IOpenAIResponsesOutputItemDoneEvent {
  type: 'response.output_item.done';
  item: TOpenAIResponsesOutputItem;
}

export interface IOpenAIResponsesErrorEvent {
  type: 'response.error' | 'response.failed' | 'response.incomplete';
  message?: string;
  error?: IOpenAIResponsesErrorBody;
  response?: IOpenAIResponsesResponse;
}

export type TOpenAIResponsesStreamEvent =
  | IOpenAIResponsesTextDeltaEvent
  | IOpenAIResponsesCompletedEvent
  | IOpenAIResponsesOutputItemDoneEvent
  | IOpenAIResponsesErrorEvent;
