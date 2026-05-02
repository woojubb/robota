import { randomUUID } from 'node:crypto';
import type { GoogleGenAI } from '@google/genai';
import type { Content, GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import type { IGeminiProviderOptions } from './types';
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
  client: GoogleGenAI,
  providerOptions: IGeminiProviderOptions,
  messages: TUniversalMessage[],
  options?: IChatOptions,
): Promise<TUniversalMessage> {
  if (!options?.model) {
    throw new Error(
      'Model is required in IChatOptions. Please specify a model in defaultModel configuration.',
    );
  }

  const geminiMessages = convertToGeminiFormat(messages);
  const genConfig = buildGenerationConfig(
    messages,
    providerOptions.defaultResponseModalities,
    providerOptions.imageCapableModels,
    options,
  );

  const result = await client.models.generateContent(
    buildGenerateContentRequest(options.model as string, geminiMessages, genConfig, options),
  );

  const convertedResponse = convertFromGeminiResponse(result);
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
  client: GoogleGenAI,
  providerOptions: IGeminiProviderOptions,
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

  const geminiMessages = convertToGeminiFormat(messages);
  const genConfig = buildGenerationConfig(
    messages,
    providerOptions.defaultResponseModalities,
    providerOptions.imageCapableModels,
    options,
  );

  const stream = await client.models.generateContentStream(
    buildGenerateContentRequest(options.model as string, geminiMessages, genConfig, options),
  );

  for await (const chunk of stream) {
    const text = extractStreamText(chunk);
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

function buildGenerateContentRequest(
  model: string,
  contents: Content[],
  generationOptions: GenerateContentParameters['config'],
  options?: IChatOptions,
): GenerateContentParameters {
  const config: GenerateContentParameters['config'] = { ...generationOptions };
  if (options?.tools && options.tools.length > 0) {
    config.tools = [{ functionDeclarations: convertToolsToGeminiFormat(options.tools) }];
  }
  return {
    model,
    contents,
    config,
  };
}

function extractStreamText(
  chunk: GenerateContentResponse | { readonly text?: () => string },
): string | undefined {
  const textValue = chunk.text;
  return typeof textValue === 'function' ? textValue() : textValue;
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
