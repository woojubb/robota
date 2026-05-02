import { randomUUID } from 'node:crypto';
import type { Content, Part, FunctionCall, GenerateContentResponse } from '@google/genai';
import type {
  TUniversalMessage,
  IAssistantMessage,
  IUserMessage,
  ISystemMessage,
  IToolMessage,
  TUniversalMessagePart,
} from '@robota-sdk/agent-core';

const RANDOM_ID_RADIX = 36;
const RANDOM_ID_LENGTH = 9;

type TGoogleJsonValue = string | number | boolean | null | TGoogleJsonValue[] | IGoogleJsonObject;

interface IGoogleJsonObject {
  readonly [key: string]: TGoogleJsonValue;
}

interface ICollectedGeminiParts {
  textValues: string[];
  messageParts: TUniversalMessagePart[];
  functionCalls: FunctionCall[];
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
  return messages.map((msg) => {
    if (msg.role === 'user') {
      return {
        role: 'user',
        parts: mapMessagePartsToGeminiParts(msg as IUserMessage),
      };
    } else if (msg.role === 'assistant') {
      return convertAssistantMessage(msg as IAssistantMessage);
    } else if (msg.role === 'tool') {
      const toolMessage = msg as IToolMessage;
      return {
        role: 'user',
        parts: mapMessagePartsToGeminiParts(toolMessage),
      };
    } else {
      const systemMessage = msg as ISystemMessage;
      const systemParts = mapMessagePartsToGeminiParts(systemMessage);
      if (systemParts.length === 0) {
        systemParts.push({ text: `System: ${systemMessage.content || ''}` });
      }
      return {
        role: 'user',
        parts: systemParts,
      };
    }
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

/** Generates a unique call identifier for function call responses. */
export function generateCallId(): string {
  return `call_${Date.now()}_${Math.random().toString(RANDOM_ID_RADIX).substr(2, RANDOM_ID_LENGTH)}`;
}

/** Converts a Gemini API response into a universal message. */
export function convertFromGeminiResponse(response: GenerateContentResponse): TUniversalMessage {
  const candidate = response.candidates?.[0];
  if (!candidate) {
    throw new Error('No candidate in Gemini response');
  }

  const content = candidate.content;
  if (!content || !content.parts || content.parts.length === 0) {
    throw new Error('No content in Gemini response');
  }

  const collectedParts = collectGeminiParts(content.parts);

  const result: TUniversalMessage = {
    id: randomUUID(),
    state: 'complete' as const,
    role: 'assistant',
    content: collectedParts.textValues.length > 0 ? collectedParts.textValues.join('') : null,
    parts: collectedParts.messageParts,
    timestamp: new Date(),
  };

  if (collectedParts.functionCalls.length > 0) {
    const assistantResult = result as IAssistantMessage;
    assistantResult.toolCalls = collectedParts.functionCalls.map((fc) => ({
      id: fc.id ?? generateCallId(),
      type: 'function' as const,
      function: {
        name: requireFunctionCallName(fc),
        arguments: JSON.stringify(fc.args ?? {}),
      },
    }));
  }

  const usageMetadata = mapUsageMetadata(response);
  if (usageMetadata) {
    result.metadata = usageMetadata;
  }

  return result;
}

function collectGeminiParts(parts: Part[]): ICollectedGeminiParts {
  const textValues: string[] = [];
  const messageParts: TUniversalMessagePart[] = [];
  const functionCalls: FunctionCall[] = [];

  for (const part of parts) {
    collectTextPart(part, textValues, messageParts);
    collectInlineImagePart(part, messageParts);
    if (part.functionCall) {
      functionCalls.push(part.functionCall);
    }
  }

  return { textValues, messageParts, functionCalls };
}

function collectTextPart(
  part: Part,
  textValues: string[],
  messageParts: TUniversalMessagePart[],
): void {
  if (typeof part.text !== 'string') {
    return;
  }
  textValues.push(part.text);
  messageParts.push({ type: 'text', text: part.text });
}

function collectInlineImagePart(part: Part, messageParts: TUniversalMessagePart[]): void {
  if (
    !part.inlineData ||
    typeof part.inlineData.data !== 'string' ||
    typeof part.inlineData.mimeType !== 'string'
  ) {
    return;
  }
  messageParts.push({
    type: 'image_inline',
    data: part.inlineData.data,
    mimeType: part.inlineData.mimeType,
  });
}

function mapUsageMetadata(response: GenerateContentResponse): TUniversalMessage['metadata'] {
  if (
    !response.usageMetadata ||
    typeof response.usageMetadata.promptTokenCount !== 'number' ||
    typeof response.usageMetadata.candidatesTokenCount !== 'number' ||
    typeof response.usageMetadata.totalTokenCount !== 'number'
  ) {
    return undefined;
  }
  return {
    promptTokens: response.usageMetadata.promptTokenCount,
    completionTokens: response.usageMetadata.candidatesTokenCount,
    totalTokens: response.usageMetadata.totalTokenCount,
  };
}

export { convertToolsToGeminiFormat } from './tool-schema-converter';

function parseToolCallArguments(serializedArguments: string): IGoogleJsonObject {
  const parsedArguments = JSON.parse(serializedArguments) as TGoogleJsonValue;
  if (!isJsonObject(parsedArguments)) {
    throw new Error('Google provider tool call arguments must be a JSON object.');
  }
  return parsedArguments;
}

function isJsonObject(value: TGoogleJsonValue): value is IGoogleJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireFunctionCallName(functionCall: FunctionCall): string {
  if (!functionCall.name || functionCall.name.trim().length === 0) {
    throw new Error('Gemini function call is missing a function name.');
  }
  return functionCall.name;
}
