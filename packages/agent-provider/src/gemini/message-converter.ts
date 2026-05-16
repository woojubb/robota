import { randomUUID } from 'node:crypto';
import type { Part, FunctionCall, GenerateContentResponse } from '@google/genai';
import type {
  TUniversalMessage,
  IAssistantMessage,
  TUniversalMessagePart,
} from '@robota-sdk/agent-core';

const RANDOM_ID_RADIX = 36;
const RANDOM_ID_LENGTH = 9;

interface ICollectedGeminiParts {
  textValues: string[];
  messageParts: TUniversalMessagePart[];
  functionCalls: FunctionCall[];
}

export {
  convertToGeminiFormat,
  convertToGeminiFormatWithInlineSystem,
  convertToGeminiRequestFormat,
  mapMessagePartsToGeminiParts,
} from './request-converter';
export type { IGeminiMessageConversionResult } from './request-converter';

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

function requireFunctionCallName(functionCall: FunctionCall): string {
  if (!functionCall.name || functionCall.name.trim().length === 0) {
    throw new Error('Gemini function call is missing a function name.');
  }
  return functionCall.name;
}
