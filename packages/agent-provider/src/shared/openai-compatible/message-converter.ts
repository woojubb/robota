import type OpenAI from 'openai';
import type {
  IAssistantMessage,
  IToolCall,
  IToolSchema,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

export function convertToOpenAICompatibleMessages(
  messages: TUniversalMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((message) => convertMessage(message));
}

export function convertToOpenAICompatibleTools(
  tools: IToolSchema[],
): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function convertMessage(message: TUniversalMessage): OpenAI.Chat.ChatCompletionMessageParam {
  if (message.role === 'user') {
    return {
      role: 'user',
      content: message.content || '',
    };
  }

  if (message.role === 'assistant') {
    return convertAssistantMessage(message);
  }

  if (message.role === 'system') {
    return {
      role: 'system',
      content: message.content || '',
    };
  }

  if (message.role === 'tool') {
    if (!message.toolCallId || message.toolCallId.trim().length === 0) {
      throw new Error(`Tool message missing toolCallId: ${JSON.stringify(message)}`);
    }
    return {
      role: 'tool',
      content: message.content || '',
      tool_call_id: message.toolCallId,
    };
  }

  const exhaustive: never = message;
  throw new Error(`Unsupported message role: ${JSON.stringify(exhaustive)}`);
}

function convertAssistantMessage(
  message: IAssistantMessage,
): OpenAI.Chat.ChatCompletionAssistantMessageParam {
  if (message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content === '' ? null : message.content || null,
      tool_calls: message.toolCalls.map((toolCall: IToolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        },
      })),
    };
  }

  return {
    role: 'assistant',
    content: message.content === null ? null : message.content || '',
  };
}
