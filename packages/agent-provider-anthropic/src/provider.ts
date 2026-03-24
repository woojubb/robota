import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { IAnthropicProviderOptions } from './types';
import { AbstractAIProvider, getModelMaxOutput } from '@robota-sdk/agent-core';
import type {
  TUniversalMessage,
  IChatOptions,
  TTextDeltaCallback,
  IToolSchema,
  IAssistantMessage,
  IToolMessage,
} from '@robota-sdk/agent-core';

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
    const anthropicMessages = this.convertToAnthropicFormat(nonSystemMessages);
    const systemPrompt = systemMessages.map((m) => m.content || '').join('\n\n') || undefined;

    if (!options?.model) {
      throw new Error(
        'Model is required in chat options. Please specify a model in defaultModel configuration.',
      );
    }

    const functionTools = options?.tools ? this.convertToolsToAnthropicFormat(options.tools) : [];
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
    return this.chatWithStreaming(baseParams, textDeltaCb, options?.signal);
  }

  /**
   * Stream internally and assemble a complete response.
   * Calls onTextDelta for each text chunk as it arrives.
   * Returns the fully assembled TUniversalMessage when done.
   */
  private async chatWithStreaming(
    params: Anthropic.MessageCreateParamsNonStreaming,
    onTextDelta: TTextDeltaCallback,
    signal?: AbortSignal,
  ): Promise<TUniversalMessage> {
    const streamParams: Anthropic.MessageCreateParamsStreaming = {
      ...params,
      stream: true,
    };

    const stream = await this.client!.messages.create(
      streamParams,
      signal ? { signal } : undefined,
    );

    // Accumulate the full response from stream events
    const textParts: string[] = [];
    const toolCalls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }> = [];
    let currentToolId = '';
    let currentToolName = '';
    let currentToolJson = '';
    let currentBlockType = '';
    let usage = { input_tokens: 0, output_tokens: 0 };
    let model = '';
    let stopReason: string | null = null;
    // Accumulate server tool result content (web search results)
    const serverToolResults: Array<{ type: string; title?: string; url?: string }> = [];

    let eventCount = 0;
    try {
      for await (const event of stream) {
        // Check abort on every event
        if (signal?.aborted) break;
        // Yield to macrotask queue every 5 events so ESC stdin handler can fire
        eventCount++;
        if (signal && eventCount % 5 === 0) {
          await new Promise<void>((resolve) => {
            setImmediate(resolve);
          });
          if (signal.aborted) break;
        }
        switch (event.type) {
          case 'message_start':
            usage = event.message.usage;
            model = event.message.model;
            break;

          case 'content_block_start':
            currentBlockType = event.content_block.type;
            if (event.content_block.type === 'tool_use') {
              currentToolId = event.content_block.id;
              currentToolName = event.content_block.name;
              currentToolJson = '';
            } else if (event.content_block.type === 'server_tool_use') {
              const serverBlock = event.content_block as {
                name?: string;
                input?: { query?: string };
              };
              const query = serverBlock.input?.query ?? '';
              const toolLabel = query
                ? `\n🔍 Searching: "${query}"\n`
                : `\n🔍 [${serverBlock.name ?? 'server_tool'}]\n`;
              textParts.push(toolLabel);
              onTextDelta(toolLabel);
              if (this.onServerToolUse) {
                this.onServerToolUse(serverBlock.name ?? 'server_tool', { query });
              }
            } else if (event.content_block.type === 'web_search_tool_result') {
              const resultBlock =
                event.content_block as Anthropic.Messages.WebSearchToolResultBlock;
              const formatted = this.formatWebSearchResults(resultBlock);
              if (formatted) {
                textParts.push(`\n${formatted}\n\n`);
                onTextDelta(`\n${formatted}\n\n`);
              }
            }
            break;

          case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
              textParts.push(event.delta.text);
              onTextDelta(event.delta.text);
            } else if (event.delta.type === 'input_json_delta') {
              currentToolJson += event.delta.partial_json;
            }
            break;

          case 'content_block_stop':
            if (currentToolId) {
              toolCalls.push({
                id: currentToolId,
                type: 'function' as const,
                function: {
                  name: currentToolName,
                  arguments: currentToolJson || '{}',
                },
              });
              currentToolId = '';
              currentToolName = '';
              currentToolJson = '';
            }
            currentBlockType = '';
            break;

          case 'message_delta':
            if (event.usage) {
              usage.output_tokens = event.usage.output_tokens;
            }
            stopReason = event.delta.stop_reason;
            break;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Return partial response from content accumulated so far
        const partialText = textParts.join('') || '';
        const partialResult: TUniversalMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: partialText,
          state: 'complete' as const,
          timestamp: new Date(),
          ...(toolCalls.length > 0 && { toolCalls }),
        };
        partialResult.metadata = {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          model,
          stopReason: 'aborted',
        };
        return partialResult;
      }
      throw err;
    }

    const textContent = textParts.join('') || '';

    const result: TUniversalMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: textContent,
      state: 'complete' as const,
      timestamp: new Date(),
      ...(toolCalls.length > 0 && { toolCalls }),
    };

    result.metadata = {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      model,
    };
    if (stopReason) {
      result.metadata['stopReason'] = stopReason;
    }

    return result;
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

    const anthropicMessages = this.convertToAnthropicFormat(messages);

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
      requestParams.tools = this.convertToolsToAnthropicFormat(options.tools);
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
   * Convert TUniversalMessage to Anthropic format
   *
   * CRITICAL: Anthropic API requires specific content handling:
   * - tool_use messages: content MUST be null
   * - regular messages: content should be a string
   */
  private convertToAnthropicFormat(messages: TUniversalMessage[]): Anthropic.MessageParam[] {
    return messages.map((msg) => {
      if (msg.role === 'user') {
        return {
          role: 'user',
          content: msg.content || '',
        };
      } else if (msg.role === 'assistant') {
        const assistantMsg = msg as IAssistantMessage;

        // Anthropic uses content blocks — include both text and tool_use
        if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
          const contentBlocks: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];

          // Include text content if present alongside tool calls
          if (assistantMsg.content) {
            contentBlocks.push({
              type: 'text' as const,
              text: assistantMsg.content,
            });
          }

          for (const tc of assistantMsg.toolCalls) {
            contentBlocks.push({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            });
          }

          return {
            role: 'assistant' as const,
            content: contentBlocks,
          };
        }

        // Regular assistant message (no tool calls)
        return {
          role: 'assistant',
          content: assistantMsg.content || '',
        };
      } else if (msg.role === 'tool') {
        // Tool result message — convert to Anthropic tool_result content block
        const toolMsg = msg as IToolMessage;
        return {
          role: 'user' as const,
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: toolMsg.toolCallId ?? '',
              content: msg.content || '',
            },
          ],
        };
      } else {
        // System messages
        return {
          role: 'user', // Anthropic doesn't have system role, use user
          content: msg.content || '',
        };
      }
    });
  }

  /**
   * Convert Anthropic response to TUniversalMessage
   */
  private convertFromAnthropicResponse(response: Anthropic.Message): TUniversalMessage {
    if (!response.content || response.content.length === 0) {
      throw new Error('No content in Anthropic response');
    }

    // Anthropic responses can contain multiple content blocks:
    // e.g., [text("I'll read the file"), tool_use(Read, {...}), tool_use(Bash, {...})]
    // We must extract ALL text and ALL tool_use blocks.
    let textParts: string[] = [];
    const toolCalls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }> = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        const textBlock = block as Anthropic.TextBlock;
        if (textBlock.text) {
          textParts.push(textBlock.text);
        }
      } else if (block.type === 'tool_use') {
        const toolBlock = block as Anthropic.ToolUseBlock;
        toolCalls.push({
          id: toolBlock.id,
          type: 'function' as const,
          function: {
            name: toolBlock.name,
            arguments: JSON.stringify(toolBlock.input),
          },
        });
      } else if (block.type === 'server_tool_use') {
        // Server tool invocation (e.g., web_search) — results come in a separate block
      } else if (block.type === 'web_search_tool_result') {
        const resultBlock = block as Anthropic.Messages.WebSearchToolResultBlock;
        const searchResults = this.formatWebSearchResults(resultBlock);
        if (searchResults) {
          textParts.push(searchResults);
        }
      }
    }

    // Use empty string instead of null so agent-core's buildFinalResult
    // doesn't reject the message. Tool-only responses have no text.
    const textContent = textParts.join('\n') || '';

    const result: TUniversalMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: textContent,
      state: 'complete' as const,
      timestamp: new Date(),
      ...(toolCalls.length > 0 && { toolCalls }),
    };

    // Add metadata if available
    if (response.usage) {
      result.metadata = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: response.model,
      };

      if (response.stop_reason) {
        result.metadata['stopReason'] = response.stop_reason;
      }
    }

    return result;
  }

  /** Format a WebSearchToolResultBlock into readable text. */
  private formatWebSearchResults(block: Anthropic.Messages.WebSearchToolResultBlock): string {
    if (!Array.isArray(block.content)) return '';

    const results = block.content
      .filter(
        (r): r is Anthropic.Messages.WebSearchResultBlock =>
          r.type === 'web_search_result' && 'title' in r && 'url' in r,
      )
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`)
      .join('\n');

    return results ? `[Web Search Results]\n${results}` : '';
  }

  /**
   * Convert tools to Anthropic format
   */
  private convertToolsToAnthropicFormat(tools: IToolSchema[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Tool.InputSchema,
    }));
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
