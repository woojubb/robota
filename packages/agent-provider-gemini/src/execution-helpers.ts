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
  convertToGeminiRequestFormat,
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
  const model = resolveGeminiModel(providerOptions, options);
  const responseModalities = buildResponseModalities(
    messages,
    providerOptions.defaultResponseModalities,
    options?.google?.responseModalities,
  );

  if (options?.onTextDelta && !responseModalities.includes('IMAGE')) {
    return assembleStreamingChatResponse(client, providerOptions, messages, options);
  }

  const requestFormat = convertToGeminiRequestFormat(messages);
  const genConfig = buildGenerationConfig(messages, providerOptions, { ...options, model });

  const result = await client.models.generateContent(
    buildGenerateContentRequest(
      model,
      requestFormat.contents,
      genConfig,
      options,
      requestFormat.systemInstruction,
    ),
  );

  const convertedResponse = convertFromGeminiResponse(result);
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
  const model = resolveGeminiModel(providerOptions, options);
  const responseModalities = buildResponseModalities(
    messages,
    providerOptions.defaultResponseModalities,
    options?.google?.responseModalities,
  );
  if (responseModalities.includes('IMAGE')) {
    throw new Error('Google provider does not support streaming image modality responses.');
  }

  const requestFormat = convertToGeminiRequestFormat(messages);
  const genConfig = buildGenerationConfig(messages, providerOptions, { ...options, model });

  const stream = await client.models.generateContentStream(
    buildGenerateContentRequest(
      model,
      requestFormat.contents,
      genConfig,
      options,
      requestFormat.systemInstruction,
    ),
  );

  for await (const chunk of stream) {
    const text = extractStreamText(chunk);
    if (text) {
      options?.onTextDelta?.(text);
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
  systemInstruction?: string,
): GenerateContentParameters {
  const config: GenerateContentParameters['config'] = { ...generationOptions };
  if (options?.tools && options.tools.length > 0) {
    config.tools = [{ functionDeclarations: convertToolsToGeminiFormat(options.tools) }];
  }
  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }
  return {
    model,
    contents,
    config,
  };
}

function resolveGeminiModel(
  providerOptions: IGeminiProviderOptions,
  options?: IChatOptions,
): string {
  const model = options?.model ?? providerOptions.defaultModel;
  if (!model) {
    throw new Error(
      'Model is required in chat options. Please specify a model in defaultModel configuration.',
    );
  }
  return model;
}

async function assembleStreamingChatResponse(
  client: GoogleGenAI,
  providerOptions: IGeminiProviderOptions,
  messages: TUniversalMessage[],
  options: IChatOptions,
): Promise<TUniversalMessage> {
  const textParts: string[] = [];
  for await (const chunk of executeDirectStream(client, providerOptions, messages, options)) {
    if (typeof chunk.content === 'string') {
      textParts.push(chunk.content);
    }
  }
  const content = textParts.join('');
  return {
    id: randomUUID(),
    role: 'assistant',
    content,
    parts: content.length > 0 ? [{ type: 'text', text: content }] : [],
    state: 'complete',
    timestamp: new Date(),
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
