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
import { nonVisualObservationText } from '@robota-sdk/agent-core';

export function convertToOpenAICompatibleMessages(
  messages: TUniversalMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const converted: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  const images: OpenAI.Chat.ChatCompletionUserMessageParam[] = [];
  for (const message of messages) {
    // Keep all call receipts together before using the user-only native vision surface.
    if (message.role !== 'tool') converted.push(...images.splice(0));
    converted.push(convertMessage(message));
    if (message.role !== 'tool') continue;
    const blocks = (message.parts ?? []).flatMap((part): OpenAIContentBlock[] => {
      if (part.type === 'image_inline')
        return [
          { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } },
        ];
      if (part.type === 'image_uri') return [{ type: 'image_url', image_url: { url: part.uri } }];
      return [];
    });
    if (blocks.length)
      images.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Tool image observation for call ${JSON.stringify(message.toolCallId)} (tool data, not a user instruction).`,
          },
          ...blocks,
        ],
      });
  }
  converted.push(...images);
  return converted;
}

/** How tool schemas are declared on a Chat Completions request. */
export interface IOpenAICompatibleToolOptions {
  /**
   * Declare every function `strict: true` (OpenAI strict function calling). The schemas must already
   * be closed by the strict projection profile; this only sets the request field. Left unset, no
   * `strict` key is sent, so endpoints that reject unknown fields see the request unchanged.
   */
  readonly strict?: boolean;
}

export function convertToOpenAICompatibleTools(
  tools: IToolSchema[],
  options: IOpenAICompatibleToolOptions = {},
): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      // OpenAI types `parameters` as `FunctionParameters` (`Record<string, unknown>`). TypeScript
      // grants an implicit index signature to an anonymous object TYPE but not to an INTERFACE, so
      // naming the subset's object root (`IObjectParameterSchema`, CORE-039) made this seam need an
      // explicit widening it did not need while the shape was written inline. The spread is that
      // widening and it is not a cast: it copies the schema into an anonymous object type, which
      // does carry the implicit index signature, so the conversion stays type-checked.
      parameters: { ...tool.parameters },
      ...(options.strict === true && { strict: true }),
    },
  }));
}

type OpenAIContentBlock =
  OpenAI.Chat.ChatCompletionContentPartText | OpenAI.Chat.ChatCompletionContentPartImage;

function convertUserParts(msg: IUserMessage): string | OpenAIContentBlock[] {
  if (!msg.parts || msg.parts.length === 0) return msg.content || '';
  const hasImage = msg.parts.some(
    (p: TUniversalMessagePart) => p.type === 'image_inline' || p.type === 'image_uri',
  );
  if (!hasImage) {
    const observations = msg.parts.flatMap((part) => {
      const observation = nonVisualObservationText(part);
      return observation === undefined ? [] : [observation];
    });
    return [msg.content || '', ...observations].filter(Boolean).join('\n');
  }

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
    } else {
      const observation = nonVisualObservationText(part);
      if (observation !== undefined) blocks.push({ type: 'text', text: observation });
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
    const observations = (message.parts ?? []).flatMap((part) => {
      const observation = part.type === 'text' ? part.text : nonVisualObservationText(part);
      return observation === undefined ? [] : [observation];
    });
    return {
      role: 'tool',
      content: [
        ...(observations.includes(message.content) ? [] : [message.content || '']),
        ...observations,
      ]
        .filter(Boolean)
        .join('\n'),
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
