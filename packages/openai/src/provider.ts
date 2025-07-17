import OpenAI from 'openai';
import type { OpenAIProviderOptions } from './types';
import type {
    OpenAIError
} from './types/api-types';
import { BaseAIProvider } from '@robota-sdk/agents';
import type {
    UniversalMessage,
    ChatOptions,
    ToolCall,
    ToolSchema,
    AssistantMessage
} from '@robota-sdk/agents';
import type { PayloadLogger } from './interfaces/payload-logger';
import { OpenAIResponseParser } from './parsers/response-parser';
import { SimpleLogger, SilentLogger } from '@robota-sdk/agents';

/**
 * OpenAI provider implementation for Robota
 * 
 * Provides integration with OpenAI's GPT models following BaseAIProvider guidelines.
 * Uses OpenAI SDK native types internally for optimal performance and feature support.
 * 
 * @public
 */
export class OpenAIProvider extends BaseAIProvider {
    override readonly name = 'openai';
    override readonly version = '1.0.0';

    private readonly client: OpenAI;
    private readonly options: OpenAIProviderOptions;
    private readonly payloadLogger: PayloadLogger | undefined;
    private readonly responseParser: OpenAIResponseParser;
    private readonly logger: SimpleLogger;

    constructor(options: OpenAIProviderOptions) {
        super();
        this.options = {
            temperature: 0.7,
            ...options
        };

        if (!options.client) {
            throw new Error('OpenAI client is required');
        }

        this.client = options.client;
        this.logger = options.logger || SilentLogger;
        this.responseParser = new OpenAIResponseParser(this.logger);

        // Initialize payload logger with backward compatibility
        this.payloadLogger = this.initializePayloadLogger(options) ?? undefined;
    }

    /**
     * Initialize payload logger
     */
    private initializePayloadLogger(options: OpenAIProviderOptions): PayloadLogger | undefined {
        return options.payloadLogger;
    }

    /**
     * Generate response using UniversalMessage
     */
    override async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage> {
        this.validateMessages(messages);

        try {
            // 1. Convert UniversalMessage → OpenAI format
            const openaiMessages = this.convertToOpenAIMessages(messages);

            // 2. Call OpenAI API (native SDK types)
            const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
                model: options?.model || 'gpt-4',
                messages: openaiMessages,
                ...(options?.temperature !== undefined && { temperature: options.temperature }),
                ...(options?.maxTokens && { max_tokens: options.maxTokens }),
                ...(options?.tools && {
                    tools: this.convertToOpenAITools(options.tools),
                    tool_choice: 'auto'
                })
            };

            // Log payload for debugging if logger is available
            if (this.payloadLogger?.isEnabled()) {
                const logData = {
                    model: requestParams.model,
                    messagesCount: openaiMessages.length,
                    hasTools: !!requestParams.tools,
                    temperature: requestParams.temperature ?? undefined,
                    maxTokens: requestParams.max_tokens ?? undefined,
                    timestamp: new Date().toISOString()
                };
                await this.payloadLogger.logPayload(logData, 'chat');
            }

            const response = await this.client.chat.completions.create(requestParams);

            // 3. Convert OpenAI response → UniversalMessage  
            return this.responseParser.parseResponse(response);

        } catch (error) {
            const openaiError = error as OpenAIError;
            const errorMessage = openaiError.message || 'OpenAI API request failed';
            throw new Error(`OpenAI chat failed: ${errorMessage}`);
        }
    }

    /**
     * Generate streaming response using UniversalMessage
     */
    override async *chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage> {
        this.validateMessages(messages);

        try {
            // 1. Convert UniversalMessage → OpenAI format
            const openaiMessages = this.convertToOpenAIMessages(messages);

            // 2. Call OpenAI streaming API
            const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
                model: options?.model || 'gpt-4',
                messages: openaiMessages,
                stream: true,
                ...(options?.temperature !== undefined && { temperature: options.temperature }),
                ...(options?.maxTokens && { max_tokens: options.maxTokens }),
                ...(options?.tools && {
                    tools: this.convertToOpenAITools(options.tools),
                    tool_choice: 'auto'
                })
            };

            // Log payload for debugging if logger is available
            if (this.payloadLogger?.isEnabled()) {
                const logData = {
                    model: requestParams.model,
                    messagesCount: openaiMessages.length,
                    hasTools: !!requestParams.tools,
                    temperature: requestParams.temperature ?? undefined,
                    maxTokens: requestParams.max_tokens ?? undefined,
                    timestamp: new Date().toISOString()
                };
                await this.payloadLogger.logPayload(logData, 'stream');
            }

            const stream = await this.client.chat.completions.create(requestParams);

            // 3. Stream conversion: OpenAI chunks → UniversalMessage
            for await (const chunk of stream) {
                const universalMessage = this.responseParser.parseStreamingChunk(chunk);
                if (universalMessage) {
                    yield universalMessage;
                }
            }

        } catch (error) {
            const openaiError = error as OpenAIError;
            const errorMessage = openaiError.message || 'OpenAI API request failed';
            throw new Error(`OpenAI stream failed: ${errorMessage}`);
        }
    }

    override supportsTools(): boolean {
        return true;
    }

    override validateConfig(): boolean {
        return !!this.client && !!this.options;
    }

    override async dispose(): Promise<void> {
        // OpenAI client doesn't need explicit cleanup
    }

    /**
     * Convert UniversalMessage array to OpenAI format
     */
    private convertToOpenAIMessages(messages: UniversalMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
        return messages.map(msg => {
            switch (msg.role) {
                case 'user':
                    return {
                        role: 'user' as const,
                        content: msg.content || ''
                    };
                case 'assistant': {
                    const assistantMsg = msg as AssistantMessage;
                    if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
                        return {
                            role: 'assistant' as const,
                            // IMPORTANT: Preserve null for tool calls as per OpenAI API spec
                            content: assistantMsg.content === '' ? null : (assistantMsg.content || null),
                            tool_calls: assistantMsg.toolCalls.map((toolCall: ToolCall) => ({
                                id: toolCall.id,
                                type: 'function' as const,
                                function: {
                                    name: toolCall.function.name,
                                    arguments: toolCall.function.arguments
                                }
                            }))
                        };
                    }
                    return {
                        role: 'assistant' as const,
                        content: msg.content || ''
                    };
                }
                case 'system':
                    return {
                        role: 'system' as const,
                        content: msg.content || ''
                    };
                case 'tool':
                    return {
                        role: 'tool' as const,
                        content: msg.content || '',
                        tool_call_id: msg.toolCallId || ''
                    };
                default:
                    // This should never happen with proper TypeScript
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    throw new Error(`Unsupported message role: ${(msg as any).role}`);
            }
        });
    }

    /**
     * Convert tool schemas to OpenAI format
     */
    private convertToOpenAITools(tools: ToolSchema[]): OpenAI.Chat.ChatCompletionTool[] {
        return tools.map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }));
    }



    /**
     * Validate messages before sending to API
     * 
     * IMPORTANT: OpenAI API Content Handling Policy
     * =============================================
     * 
     * Based on OpenAI API documentation and community feedback:
     * 
     * 1. When sending TO OpenAI API:
     *    - Assistant messages with tool_calls: content MUST be null (not empty string)
     *    - Regular assistant messages: content can be string or null
     *    - This prevents "400 Bad Request" errors
     * 
     * 2. When receiving FROM our API (UniversalMessage):
     *    - All messages must have content as string (TypeScript requirement)
     *    - Convert null to empty string for type compatibility
     * 
     * 3. This dual handling ensures:
     *    - OpenAI API compatibility (null for tool calls)
     *    - TypeScript type safety (string content in UniversalMessage)
     *    - No infinite loops in tool execution
     * 
     * Reference: OpenAI Community discussions confirm that tool_calls
     * require content to be null, not empty string.
     */
    protected override validateMessages(messages: UniversalMessage[]): void {
        super.validateMessages(messages);

        // Additional OpenAI-specific validation
        for (const message of messages) {
            if (message.role === 'assistant') {
                const assistantMsg = message as AssistantMessage;
                if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0 && assistantMsg.content === '') {
                    // This is valid - we'll convert to null when sending to OpenAI
                    continue;
                }
            }
        }
    }
} 