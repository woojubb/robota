import { randomUUID } from 'node:crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { IGoogleProviderOptions } from './types';
import type {
  TUniversalMessage,
  IChatOptions,
  IImageGenerationResult,
  TProviderMediaResult,
} from '@robota-sdk/agent-core';
import {
  convertToGeminiFormat,
  convertFromGeminiResponse,
  convertToolsToGeminiFormat,
} from './message-converter';
import {
  hasImagePart,
  mapInlineImagePartsToMediaOutputs,
  buildResponseModalities,
  buildGenerationConfig,
} from './image-operations';

/**
 * Execute a direct (non-streaming) chat request against the Gemini API.
 */
export async function executeDirect(
  client: GoogleGenerativeAI,
  providerOptions: IGoogleProviderOptions,
  messages: TUniversalMessage[],
  options?: IChatOptions,
): Promise<TUniversalMessage> {
  if (!options?.model) {
    throw new Error(
      'Model is required in IChatOptions. Please specify a model in defaultModel configuration.',
    );
  }

  const model = client.getGenerativeModel({ model: options.model as string });
  const geminiMessages = convertToGeminiFormat(messages);
  const genConfig = buildGenerationConfig(
    messages,
    providerOptions.defaultResponseModalities,
    providerOptions.imageCapableModels,
    options,
  );

  const result = await model.generateContent({
    contents: geminiMessages,
    generationConfig: genConfig,
    ...(options?.tools && {
      tools: [{ functionDeclarations: convertToolsToGeminiFormat(options.tools) }],
    }),
  });

  const convertedResponse = convertFromGeminiResponse(result.response);
  const responseModalities = buildResponseModalities(
    messages,
    providerOptions.defaultResponseModalities,
    options?.google?.responseModalities,
  );
  if (responseModalities.includes('IMAGE') && !hasImagePart(convertedResponse.parts)) {
    throw new Error(
      'Gemini response did not include an image part while IMAGE modality was requested.',
    );
  }
  return convertedResponse;
}

/**
 * Execute a streaming chat request against the Gemini API.
 */
export async function* executeDirectStream(
  client: GoogleGenerativeAI,
  providerOptions: IGoogleProviderOptions,
  messages: TUniversalMessage[],
  options?: IChatOptions,
): AsyncIterable<TUniversalMessage> {
  const responseModalities = buildResponseModalities(
    messages,
    providerOptions.defaultResponseModalities,
    options?.google?.responseModalities,
  );
  if (responseModalities.includes('IMAGE')) {
    throw new Error('Google provider does not support streaming image modality responses.');
  }
  if (!options?.model) {
    throw new Error(
      'Model is required in IChatOptions. Please specify a model in defaultModel configuration.',
    );
  }

  const model = client.getGenerativeModel({ model: options.model as string });
  const geminiMessages = convertToGeminiFormat(messages);
  const genConfig = buildGenerationConfig(
    messages,
    providerOptions.defaultResponseModalities,
    providerOptions.imageCapableModels,
    options,
  );

  const result = await model.generateContentStream({
    contents: geminiMessages,
    generationConfig: genConfig,
    ...(options?.tools && {
      tools: [{ functionDeclarations: convertToolsToGeminiFormat(options.tools) }],
    }),
  });

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      yield {
        id: randomUUID(),
        role: 'assistant',
        content: text,
        state: 'complete' as const,
        timestamp: new Date(),
      };
    }
  }
}

/**
 * Run an image generation request through the chat API.
 */
export async function runImageRequest(
  chatFn: (messages: TUniversalMessage[], options?: IChatOptions) => Promise<TUniversalMessage>,
  messages: TUniversalMessage[],
  model: string,
): Promise<TProviderMediaResult<IImageGenerationResult>> {
  try {
    const response = await chatFn(messages, {
      model,
      google: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    const outputs = mapInlineImagePartsToMediaOutputs(response.parts);
    if (outputs.length === 0) {
      return {
        ok: false,
        error: {
          code: 'PROVIDER_UPSTREAM_ERROR',
          message: 'Google image response did not include image output parts.',
        },
      };
    }
    return { ok: true, value: { outputs, model } };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Google image request failed.';
    return { ok: false, error: { code: 'PROVIDER_UPSTREAM_ERROR', message: errorMessage } };
  }
}
