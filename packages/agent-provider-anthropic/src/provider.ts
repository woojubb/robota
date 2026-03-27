import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { IAnthropicProviderOptions } from './types';
import { AbstractAIProvider, getModelMaxOutput } from '@robota-sdk/agent-core';
import type { TUniversalMessage, IChatOptions, TTextDeltaCallback } from '@robota-sdk/agent-core';
import { convertToAnthropicFormat, convertToolsToAnthropicFormat } from './message-converter';
import { streamAndAssemble } from './streaming-handler';

/**
 * Anthropic provider implementation for Robota
 *
 * IMPORTANT PROVIDER-SPECIFIC RULES:
 * 1. This provider MUST extend BaseAIProvider from @robota-sdk/agent-core
 * 2. Content handling for Anthropic API:
 *    - When tool_calls are present: content MUST be null (not empty string)
 *    - For regular assistant messages: content should be a string
 * 3. Use override keyword for all methods inherited from BaseAIProvider
 * 4. Provider-specific API behavior should be documented here
 *
 * @public
 */
export class AnthropicProvider extends AbstractAIProvider {
  override readonly name = 'anthropic';
  override readonly version = '1.0.0';

  private readonly client?: Anthropic;
  private readonly options: IAnthropicProviderOptions;

  /**
   * When true, Anthropic server tools (web_search) are included in every request.
   * The server executes these tools internally — no local tool registration needed.
   */
  enableWebTools = false;

  /**
   * Optional callback for text deltas during streaming.
   * Set by the consumer (e.g., Session) to receive real-time text chunks.
   * When set, chat() uses streaming internally while still returning
   * the complete assembled message.
   */
  onTextDelta?: TTextDeltaCallback;

  /** Callback when a server tool (web_search etc.) is invoked by the API */
  onServerToolUse?: (toolName: string, input: Record<string, string>) => void;

  constructor(options: IAnthropicProviderOptions) {
    super();
    this.options = options;

    // Set executor if provided
    if (options.executor) {
      this.executor = options.executor;
    }

    // Only create client if not using executor
    if (!this.executor) {
      // Create client from apiKey if not provided
      if (options.client) {
        this.client = options.client;
      } else if (options.apiKey) {
        this.client = new Anthropic({
          apiKey: options.apiKey,
          ...(options.timeout && { timeout: options.timeout }),
          ...(options.baseURL && { baseURL: options.baseURL }),
        });
      } else {
        throw new Error('Either Anthropic client, apiKey, or executor is required');
      }
    }
  }

  /**
   * Generate response using TUniversalMessage
   */
  override async chat(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    this.validateMessages(messages);

    // Use executor when configured; otherwise use direct execution
    if (this.executor) {
      try {
        return await this.executeViaExecutorOrDirect(messages, options);
      } catch (error) {
        throw error;
      }
    }

    // Direct execution with Anthropic client
    if (!this.client) {
      throw new Error(
        'Anthropic client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    // Separate system messages for the Anthropic system parameter
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');
    const anthropicMessages = convertToAnthropicFormat(nonSystemMessages);
    const systemPrompt = systemMessages.map((m) => m.content || '').join('\n\n') || undefined;

    if (!options?.model) {
      throw new Error(
        'Model is required in chat options. Please specify a model in defaultModel configuration.',
      );
    }

    const functionTools = options?.tools ? convertToolsToAnthropicFormat(options.tools) : [];
    const serverTools: Anthropic.Messages.ToolUnion[] = this.enableWebTools
      ? [{ type: 'web_search_20250305' as const, name: 'web_search' }]
      : [];
    const allTools: Anthropic.Messages.ToolUnion[] = [...functionTools, ...serverTools];

    const baseParams: Anthropic.MessageCreateParamsNonStreaming = {
      model: options.model as string,
      messages: anthropicMessages,
      max_tokens: options?.maxTokens || getModelMaxOutput(options.model as string),
      ...(systemPrompt && { system: systemPrompt }),
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(allTools.length > 0 && { tools: allTools }),
    };

    // Always use streaming to avoid Anthropic SDK's 10-minute non-streaming timeout.
    // When no onTextDelta callback is available, use a no-op to silently assemble the response.
    const textDeltaCb = options?.onTextDelta ?? this.onTextDelta ?? (() => {});
    return streamAndAssemble(
      this.client,
      baseParams,
      textDeltaCb,
      this.onServerToolUse,
      options?.signal,
    );
  }

  /**
   * Generate streaming response using TUniversalMessage
   */
  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    this.validateMessages(messages);

    // Use executor when configured; otherwise use direct execution
    if (this.executor) {
      try {
        yield* this.executeStreamViaExecutorOrDirect(messages, options);
        return;
      } catch (error) {
        throw error;
      }
    }

    // Direct execution with Anthropic client
    if (!this.client) {
      throw new Error(
        'Anthropic client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    const anthropicMessages = convertToAnthropicFormat(messages);

    if (!options?.model) {
      throw new Error(
        'Model is required in chat options. Please specify a model in defaultModel configuration.',
      );
    }

    const requestParams: Anthropic.MessageCreateParamsStreaming = {
      model: options.model as string,
      messages: anthropicMessages,
      max_tokens: options?.maxTokens || getModelMaxOutput(options.model as string),
      stream: true,
    };

    if (options?.temperature !== undefined) {
      requestParams.temperature = options.temperature;
    }

    if (options?.tools) {
      requestParams.tools = convertToolsToAnthropicFormat(options.tools);
    }

    const stream = await this.client.messages.create(requestParams);

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield {
          id: randomUUID(),
          role: 'assistant',
          content: chunk.delta.text,
          state: 'complete' as const,
          timestamp: new Date(),
        };
      }
    }
  }

  override supportsTools(): boolean {
    return true;
  }

  override validateConfig(): boolean {
    return !!this.client && !!this.options && !!this.options.apiKey;
  }

  override async dispose(): Promise<void> {
    // Anthropic client doesn't need explicit cleanup
  }

  /**
   * Validate TUniversalMessage array
   */
  protected override validateMessages(messages: TUniversalMessage[]): void {
    if (!Array.isArray(messages)) {
      throw new Error('Messages must be an array');
    }

    if (messages.length === 0) {
      throw new Error('Messages array cannot be empty');
    }

    for (const message of messages) {
      if (!message.role || !['user', 'assistant', 'system', 'tool'].includes(message.role)) {
        throw new Error(`Invalid message role: ${message.role}`);
      }
    }
  }
}
