import type {
  IAssistantMessage,
  IInlineImageMessagePart,
  IToolCall,
  IToolSchema,
  IUriImageMessagePart,
  IUserMessage,
  TUniversalMessage,
  TUniversalMessagePart,
} from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

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

type OpenAIContentBlock =
  | OpenAI.Chat.ChatCompletionContentPartText
  | OpenAI.Chat.ChatCompletionContentPartImage;

function convertUserParts(msg: IUserMessage): string | OpenAIContentBlock[] {
  if (!msg.parts || msg.parts.length === 0) return msg.content || '';
  const hasImage = msg.parts.some(
    (p: TUniversalMessagePart) => p.type === 'image_inline' || p.type === 'image_uri',
  );
  if (!hasImage) return msg.content || '';

  const blocks: OpenAIContentBlock[] = [];
  for (const part of msg.parts) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_inline') {
      const inline = part as IInlineImageMessagePart;
      blocks.push({
        type: 'image_url',
        image_url: { url: `data:${inline.mimeType};base64,${inline.data}` },
      });
    } else if (part.type === 'image_uri') {
      const uri = part as IUriImageMessagePart;
      blocks.push({ type: 'image_url', image_url: { url: uri.uri } });
    }
  }
  if (blocks.length === 0) return msg.content || '';
  return blocks;
}

function convertMessage(message: TUniversalMessage): OpenAI.Chat.ChatCompletionMessageParam {
  if (message.role === 'user') {
    return {
      role: 'user',
      content: convertUserParts(message),
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
