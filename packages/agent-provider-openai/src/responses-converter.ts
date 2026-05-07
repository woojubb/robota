import type {
  IAssistantMessage,
  IToolSchema,
  TUniversalMessage,
  TUniversalMessagePart,
} from '@robota-sdk/agent-core';
import type {
  IOpenAIResponsesFunctionTool,
  IOpenAIResponsesMessageInput,
  TOpenAIResponsesInputContent,
  TOpenAIResponsesInputItem,
} from './responses-types';

export function convertToOpenAIResponsesInput(
  messages: TUniversalMessage[],
): TOpenAIResponsesInputItem[] {
  return messages.flatMap((message) => convertMessage(message));
}

export function convertToOpenAIResponsesTools(
  tools: IToolSchema[] | undefined,
  strictTools: boolean | undefined,
): IOpenAIResponsesFunctionTool[] | undefined {
  const converted =
    tools?.map((tool) => ({
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: strictTools ?? false,
    })) ?? [];
  return converted.length > 0 ? converted : undefined;
}

function convertMessage(message: TUniversalMessage): TOpenAIResponsesInputItem[] {
  if (message.role === 'user') {
    return [createMessageInput('user', getUserContent(message.content, message.parts))];
  }
  if (message.role === 'system') {
    return [createMessageInput('system', message.content)];
  }
  if (message.role === 'tool') {
    if (!message.toolCallId || message.toolCallId.trim().length === 0) {
      throw new Error(`Tool message missing toolCallId: ${JSON.stringify(message)}`);
    }
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

function convertAssistantMessage(message: IAssistantMessage): TOpenAIResponsesInputItem[] {
  const items: TOpenAIResponsesInputItem[] = [];
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

function getUserContent(
  content: string,
  parts: TUniversalMessagePart[] | undefined,
): string | TOpenAIResponsesInputContent[] {
  if (!parts || parts.length === 0) {
    return content;
  }

  const converted = parts.map((part) => convertPart(part));
  if (content.length > 0 && !parts.some((part) => part.type === 'text')) {
    return [{ type: 'input_text', text: content }, ...converted];
  }
  return converted;
}

function convertPart(part: TUniversalMessagePart): TOpenAIResponsesInputContent {
  if (part.type === 'text') {
    return { type: 'input_text', text: part.text };
  }
  if (part.type === 'image_uri') {
    return { type: 'input_image', image_url: part.uri };
  }
  return {
    type: 'input_image',
    image_url: `data:${part.mimeType};base64,${part.data}`,
  };
}

function createMessageInput(
  role: IOpenAIResponsesMessageInput['role'],
  content: string | TOpenAIResponsesInputContent[],
): IOpenAIResponsesMessageInput {
  return {
    role,
    content,
  };
}
