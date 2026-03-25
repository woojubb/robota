import { randomUUID } from 'node:crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { IGoogleProviderOptions } from './types';
import { AbstractAIProvider } from '@robota-sdk/agent-core';
import type {
  TUniversalMessage,
  IChatOptions,
  TUniversalMessagePart,
  IImageGenerationProvider,
  IImageGenerationRequest,
  IImageEditRequest,
  IImageComposeRequest,
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
  mapImageInputSourceToPart,
  buildResponseModalities,
  buildGenerationConfig,
} from './image-operations';

/**
 * Google Gemini provider implementation for Robota
 *
 * IMPORTANT PROVIDER-SPECIFIC RULES:
 * 1. This provider MUST extend BaseAIProvider from @robota-sdk/agent-core
 * 2. Content handling for Google Gemini API:
 *    - Function calls can have content (text) along with function calls
 *    - Content can be empty string or actual text, NOT null
 * 3. Use override keyword for all methods inherited from BaseAIProvider
 * 4. Provider-specific API behavior should be documented here
 *
 * @public
 */
export class GoogleProvider extends AbstractAIProvider implements IImageGenerationProvider {
  override readonly name = 'google';
  override readonly version = '1.0.0';

  private readonly client?: GoogleGenerativeAI;
  private readonly options: IGoogleProviderOptions;

  constructor(options: IGoogleProviderOptions) {
    super();
    this.options = options;

    if (options.executor) {
      this.executor = options.executor;
    }

    if (!this.executor) {
      this.client = new GoogleGenerativeAI(options.apiKey);
    }
  }

  /** Generate response using TUniversalMessage */
  override async chat(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    this.validateMessages(messages);

    if (this.executor) {
      try {
        return await this.executeViaExecutorOrDirect(messages, options);
      } catch (error) {
        this.logger.error(
          'Google Provider executor chat error:',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }

    try {
      return await this.executeDirect(messages, options);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Google API request failed';
      throw new Error(`Google chat failed: ${errorMessage}`);
    }
  }

  /** Generate streaming response using TUniversalMessage */
  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    this.validateMessages(messages);
    if (this.executor) {
      try {
        yield* this.executeStreamViaExecutorOrDirect(messages, options);
        return;
      } catch (error) {
        this.logger.error(
          'Google Provider executor stream error:',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }

    try {
      yield* this.executeDirectStream(messages, options);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Google API request failed';
      throw new Error(`Google stream failed: ${errorMessage}`);
    }
  }

  /** Generate an image from a text prompt using the Gemini API. */
  public async generateImage(
    request: IImageGenerationRequest,
  ): Promise<TProviderMediaResult<IImageGenerationResult>> {
    if (request.prompt.trim().length === 0) {
      return {
        ok: false,
        error: {
          code: 'PROVIDER_INVALID_REQUEST',
          message: 'Image generation requires a non-empty prompt.',
        },
      };
    }
    if (request.model.trim().length === 0) {
      return {
        ok: false,
        error: {
          code: 'PROVIDER_INVALID_REQUEST',
          message: 'Image generation requires a non-empty model.',
        },
      };
    }

    const message: TUniversalMessage = {
      id: randomUUID(),
      role: 'user',
      content: request.prompt,
      state: 'complete' as const,
      parts: [{ type: 'text', text: request.prompt }],
      timestamp: new Date(),
    };
    return this.runImageRequest([message], request.model);
  }

  /** Edit an existing image based on a text prompt using the Gemini API. */
  public async editImage(
    request: IImageEditRequest,
  ): Promise<TProviderMediaResult<IImageGenerationResult>> {
    if (request.prompt.trim().length === 0) {
      return {
        ok: false,
        error: {
          code: 'PROVIDER_INVALID_REQUEST',
          message: 'Image edit requires a non-empty prompt.',
        },
      };
    }
    if (request.model.trim().length === 0) {
      return {
        ok: false,
        error: {
          code: 'PROVIDER_INVALID_REQUEST',
          message: 'Image edit requires a non-empty model.',
        },
      };
    }

    const inputPartResult = mapImageInputSourceToPart(request.image);
    if (!inputPartResult.ok) {
      return inputPartResult;
    }

    const message: TUniversalMessage = {
      id: randomUUID(),
      role: 'user',
      content: request.prompt,
      state: 'complete' as const,
      parts: [inputPartResult.value, { type: 'text', text: request.prompt }],
      timestamp: new Date(),
    };
    return this.runImageRequest([message], request.model);
  }

  /** Compose multiple images together based on a text prompt using the Gemini API. */
  public async composeImage(
    request: IImageComposeRequest,
  ): Promise<TProviderMediaResult<IImageGenerationResult>> {
    if (request.prompt.trim().length === 0) {
      return {
        ok: false,
        error: {
          code: 'PROVIDER_INVALID_REQUEST',
          message: 'Image compose requires a non-empty prompt.',
        },
      };
    }
    if (request.model.trim().length === 0) {
      return {
        ok: false,
        error: {
          code: 'PROVIDER_INVALID_REQUEST',
          message: 'Image compose requires a non-empty model.',
        },
      };
    }
    if (request.images.length < 2) {
      return {
        ok: false,
        error: {
          code: 'PROVIDER_INVALID_REQUEST',
          message: 'Image compose requires at least two input images.',
        },
      };
    }

    const messageParts: TUniversalMessagePart[] = [];
    for (const imageSource of request.images) {
      const mappedPartResult = mapImageInputSourceToPart(imageSource);
      if (!mappedPartResult.ok) {
        return mappedPartResult;
      }
      messageParts.push(mappedPartResult.value);
    }
    messageParts.push({ type: 'text', text: request.prompt });

    const message: TUniversalMessage = {
      id: randomUUID(),
      role: 'user',
      content: request.prompt,
      state: 'complete' as const,
      parts: messageParts,
      timestamp: new Date(),
    };
    return this.runImageRequest([message], request.model);
  }

  override supportsTools(): boolean {
    return true;
  }

  override validateConfig(): boolean {
    return !!this.client && !!this.options && !!this.options.apiKey;
  }

  override async dispose(): Promise<void> {
    // Google client does not need explicit cleanup
  }

  private async executeDirect(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    if (!this.client) {
      throw new Error('Google client not available. Either provide apiKey or use an executor.');
    }
    if (!options?.model) {
      throw new Error(
        'Model is required in IChatOptions. Please specify a model in defaultModel configuration.',
      );
    }

    const model = this.client.getGenerativeModel({ model: options.model as string });
    const geminiMessages = convertToGeminiFormat(messages);
    const genConfig = buildGenerationConfig(
      messages,
      this.options.defaultResponseModalities,
      this.options.imageCapableModels,
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
      this.options.defaultResponseModalities,
      options?.google?.responseModalities,
    );
    if (responseModalities.includes('IMAGE') && !hasImagePart(convertedResponse.parts)) {
      throw new Error(
        'Gemini response did not include an image part while IMAGE modality was requested.',
      );
    }
    return convertedResponse;
  }

  private async *executeDirectStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    const responseModalities = buildResponseModalities(
      messages,
      this.options.defaultResponseModalities,
      options?.google?.responseModalities,
    );
    if (responseModalities.includes('IMAGE')) {
      throw new Error('Google provider does not support streaming image modality responses.');
    }
    if (!this.client) {
      throw new Error('Google client not available. Either provide apiKey or use an executor.');
    }
    if (!options?.model) {
      throw new Error(
        'Model is required in IChatOptions. Please specify a model in defaultModel configuration.',
      );
    }

    const model = this.client.getGenerativeModel({ model: options.model as string });
    const geminiMessages = convertToGeminiFormat(messages);
    const genConfig = buildGenerationConfig(
      messages,
      this.options.defaultResponseModalities,
      this.options.imageCapableModels,
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

  private async runImageRequest(
    messages: TUniversalMessage[],
    model: string,
  ): Promise<TProviderMediaResult<IImageGenerationResult>> {
    try {
      const response = await this.chat(messages, {
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
}
