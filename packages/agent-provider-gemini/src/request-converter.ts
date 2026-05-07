import type { Content, Part } from '@google/genai';
import type {
  IAssistantMessage,
  ISystemMessage,
  IToolMessage,
  IUserMessage,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

type TGoogleJsonValue = string | number | boolean | null | TGoogleJsonValue[] | IGoogleJsonObject;

interface IGoogleJsonObject {
  readonly [key: string]: TGoogleJsonValue;
}

export interface IGeminiMessageConversionResult {
  contents: Content[];
  systemInstruction?: string;
}

/**
 * Maps universal message parts to Gemini-compatible parts.
 * Supports text and inline image parts; throws on unsupported part types.
 */
export function mapMessagePartsToGeminiParts(
  message: IUserMessage | IAssistantMessage | ISystemMessage | IToolMessage,
): Part[] {
  const parts: Part[] = [];
  const messageParts = message.parts ?? [];
  for (const part of messageParts) {
    if (part.type === 'text') {
      parts.push({ text: part.text });
      continue;
    }
    if (part.type === 'image_inline') {
      parts.push({
        inlineData: {
          mimeType: part.mimeType,
          data: part.data,
        },
      });
      continue;
    }
    throw new Error(`Google provider does not support image URI parts directly: ${part.uri}`);
  }
  if (parts.length === 0 && typeof message.content === 'string' && message.content.length > 0) {
    parts.push({ text: message.content });
  }
  return parts;
}

/**
 * Converts an array of universal messages to the Gemini Content format.
 *
 * IMPORTANT: Google Gemini allows content with function calls.
 * Content can be empty string or text, but NOT null.
 */
export function convertToGeminiFormat(messages: TUniversalMessage[]): Content[] {
  return convertToGeminiRequestFormat(messages).contents;
}

/**
 * Converts universal messages into Gemini request content plus request config
 * fields. Gemini system instructions are request-level config, not user turns.
 */
export function convertToGeminiRequestFormat(
  messages: TUniversalMessage[],
): IGeminiMessageConversionResult {
  const contents: Content[] = [];
  const systemInstructionParts: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      contents.push({
        role: 'user',
        parts: mapMessagePartsToGeminiParts(msg as IUserMessage),
      });
      continue;
    }
    if (msg.role === 'assistant') {
      contents.push(convertAssistantMessage(msg as IAssistantMessage));
      continue;
    }
    if (msg.role === 'tool') {
      contents.push(convertToolMessage(msg as IToolMessage));
      continue;
    }

    const systemInstruction = extractSystemInstructionText(msg as ISystemMessage);
    if (systemInstruction.length > 0) {
      systemInstructionParts.push(systemInstruction);
    }
  }

  return {
    contents,
    ...(systemInstructionParts.length > 0 && {
      systemInstruction: systemInstructionParts.join('\n'),
    }),
  };
}

/**
 * Converts all messages to Gemini contents, including system instructions as
 * user content. This exists only for compatibility with callers that still need
 * a contents-only value.
 */
export function convertToGeminiFormatWithInlineSystem(messages: TUniversalMessage[]): Content[] {
  return messages.map((msg) => {
    if (msg.role === 'user') {
      return {
        role: 'user',
        parts: mapMessagePartsToGeminiParts(msg as IUserMessage),
      };
    }
    if (msg.role === 'assistant') {
      return convertAssistantMessage(msg as IAssistantMessage);
    }
    if (msg.role === 'tool') {
      const toolMessage = msg as IToolMessage;
      return {
        role: 'user',
        parts: mapMessagePartsToGeminiParts(toolMessage),
      };
    }
    const systemMessage = msg as ISystemMessage;
    const systemParts = mapMessagePartsToGeminiParts(systemMessage);
    if (systemParts.length === 0) {
      systemParts.push({ text: `System: ${systemMessage.content || ''}` });
    }
    return {
      role: 'user',
      parts: systemParts,
    };
  });
}

function convertAssistantMessage(assistantMsg: IAssistantMessage): Content {
  const parts: Part[] = [];
  const mappedAssistantParts = mapMessagePartsToGeminiParts(assistantMsg);
  for (const mappedPart of mappedAssistantParts) {
    parts.push(mappedPart);
  }
  if (parts.length === 0 && assistantMsg.content) {
    parts.push({ text: assistantMsg.content });
  }
  if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
    assistantMsg.toolCalls.forEach((tc) => {
      parts.push({
        functionCall: {
          id: tc.id,
          name: tc.function.name,
          args: parseToolCallArguments(tc.function.arguments),
        },
      });
    });
  }
  return {
    role: 'model',
    parts,
  };
}

function convertToolMessage(toolMessage: IToolMessage): Content {
  const functionResponse = {
    id: toolMessage.toolCallId,
    name: requireToolMessageName(toolMessage),
    response: parseToolResponseContent(toolMessage.content),
  };
  return {
    role: 'user',
    parts: [{ functionResponse }],
  };
}

function extractSystemInstructionText(systemMessage: ISystemMessage): string {
  const parts = mapMessagePartsToGeminiParts(systemMessage);
  if (parts.length === 0) {
    return systemMessage.content;
  }
  const textParts: string[] = [];
  for (const part of parts) {
    if (typeof part.text === 'string') {
      textParts.push(part.text);
      continue;
    }
    throw new Error('Google provider system instructions support only text parts.');
  }
  return textParts.join('\n');
}

function requireToolMessageName(toolMessage: IToolMessage): string {
  const toolName = toolMessage.name?.trim();
  if (!toolName) {
    throw new Error('Google provider tool message requires a function name.');
  }
  return toolName;
}

function parseToolCallArguments(serializedArguments: string): IGoogleJsonObject {
  const parsedArguments = JSON.parse(serializedArguments) as TGoogleJsonValue;
  if (!isJsonObject(parsedArguments)) {
    throw new Error('Google provider tool call arguments must be a JSON object.');
  }
  return parsedArguments;
}

function parseToolResponseContent(content: string): IGoogleJsonObject {
  const trimmedContent = content.trim();
  if (trimmedContent.length === 0) {
    return { output: null };
  }
  try {
    const parsedContent = JSON.parse(trimmedContent) as TGoogleJsonValue;
    if (isJsonObject(parsedContent)) {
      return parsedContent;
    }
    return { output: parsedContent };
  } catch {
    return { output: content };
  }
}

function isJsonObject(value: TGoogleJsonValue): value is IGoogleJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
