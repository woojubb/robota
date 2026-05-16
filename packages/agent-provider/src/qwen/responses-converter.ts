import type { IAssistantMessage, IToolSchema, TUniversalMessage } from '@robota-sdk/agent-core';
import type {
  IQwenBuiltInWebToolsOptions,
  IQwenResponsesFunctionTool,
  IQwenResponsesMessageInput,
  TQwenBuiltInWebToolName,
  TQwenResponsesInputItem,
  TQwenResponsesTool,
} from './types';

export function getQwenBuiltInWebToolNames(
  options: IQwenBuiltInWebToolsOptions | undefined,
): TQwenBuiltInWebToolName[] {
  const tools: TQwenBuiltInWebToolName[] = [];
  if (options?.webSearch === true || options?.webFetch === true) {
    tools.push('web_search');
  }
  if (options?.webFetch === true) {
    tools.push('web_extractor');
  }
  return tools;
}

export function hasQwenBuiltInWebTools(options: IQwenBuiltInWebToolsOptions | undefined): boolean {
  return getQwenBuiltInWebToolNames(options).length > 0;
}

export function convertToQwenResponsesInput(
  messages: TUniversalMessage[],
): TQwenResponsesInputItem[] {
  return messages.flatMap((message) => convertMessage(message));
}

export function buildQwenResponsesTools(
  builtInWebTools: readonly TQwenBuiltInWebToolName[],
  localTools: IToolSchema[] | undefined,
): TQwenResponsesTool[] | undefined {
  const tools: TQwenResponsesTool[] = [
    ...builtInWebTools.map((type) => ({ type })),
    ...convertToQwenResponsesFunctionTools(localTools),
  ];
  return tools.length > 0 ? tools : undefined;
}

function convertToQwenResponsesFunctionTools(
  tools: IToolSchema[] | undefined,
): IQwenResponsesFunctionTool[] {
  return (
    tools?.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })) ?? []
  );
}

function convertMessage(message: TUniversalMessage): TQwenResponsesInputItem[] {
  if (message.role === 'user') {
    return [createMessageInput('user', message.content)];
  }
  if (message.role === 'system') {
    return [createMessageInput('system', message.content)];
  }
  if (message.role === 'tool') {
    return [
      {
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: message.content || '',
      },
    ];
  }
  return convertAssistantMessage(message);
}

function convertAssistantMessage(message: IAssistantMessage): TQwenResponsesInputItem[] {
  const items: TQwenResponsesInputItem[] = [];
  if (message.content && message.content.length > 0) {
    items.push(createMessageInput('assistant', message.content));
  }
  for (const toolCall of message.toolCalls ?? []) {
    items.push({
      type: 'function_call',
      call_id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    });
  }
  if (items.length === 0) {
    items.push(createMessageInput('assistant', ''));
  }
  return items;
}

function createMessageInput(
  role: IQwenResponsesMessageInput['role'],
  content: string | null,
): IQwenResponsesMessageInput {
  return {
    role,
    content: content ?? '',
  };
}
