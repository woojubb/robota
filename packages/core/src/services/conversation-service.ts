import type {
    RunOptions
} from '../types';
import type { AIProvider, Context, Message, ModelResponse, StreamingResponseChunk } from '../interfaces/ai-provider';
import type { Logger } from '../interfaces/logger';
import type { ConversationHistory, UniversalMessage } from '../conversation-history';
import { logger } from '../utils';

/**
 * Conversation service class
 * Handles conversation processing with AI.
 */
export class ConversationService {
    private temperature?: number;
    private maxTokens?: number;
    private logger: Logger;
    private debug: boolean;

    constructor(
        temperature?: number,
        maxTokens?: number,
        logger: Logger = console,
        debug: boolean = false
    ) {
        this.temperature = temperature;
        this.maxTokens = maxTokens;
        this.logger = logger;
        this.debug = debug;
    }

    /**
     * Prepare context
     * 
     * @param conversationHistory - ConversationHistory instance
     * @param systemPrompt - Optional system prompt
     * @param systemMessages - System messages
     * @param options - Run options
     */
    prepareContext(
        conversationHistory: ConversationHistory,
        systemPrompt?: string,
        systemMessages?: Message[],
        options: RunOptions = {}
    ): Context {
        // Get universal messages from conversation history
        // AI Provider will convert these to appropriate format
        const universalMessages = conversationHistory.getMessages();

        const context: Context = {
            messages: universalMessages
        };

        // Handle system messages
        if (options.systemPrompt) {
            context.systemPrompt = options.systemPrompt;
        } else if (systemMessages && systemMessages.length > 0) {
            context.systemMessages = systemMessages;
        } else if (systemPrompt) {
            context.systemPrompt = systemPrompt;
        }

        return context;
    }

    /**
     * Generate response
     * 
     * @param aiProvider - AI provider
     * @param model - Model name
     * @param context - Conversation context
     * @param options - Run options
     * @param availableTools - Available tools
     * @param onToolCall - Tool call function
     */
    async generateResponse(
        aiProvider: AIProvider,
        model: string,
        context: Context,
        options: RunOptions = {},
        availableTools: any[] = [],
        onToolCall?: (toolName: string, params: any) => Promise<any>
    ): Promise<ModelResponse> {
        try {
            // Generate response through AI provider
            const response = await aiProvider.chat(model, context, {
                ...options,
                temperature: options.temperature ?? this.temperature,
                maxTokens: options.maxTokens ?? this.maxTokens,
                tools: availableTools,
                functionCallMode: options.functionCallMode,
                forcedFunction: options.forcedFunction,
                forcedArguments: options.forcedArguments
            });

            // Automatically execute if there is a function call
            if (response.functionCall && options.functionCallMode !== 'disabled' && onToolCall) {
                return await this.handleFunctionCall(
                    response,
                    context,
                    aiProvider,
                    model,
                    options,
                    availableTools,
                    onToolCall
                );
            }

            return response;
        } catch (error) {
            logger.error('Error occurred during AI client call:', error);
            throw new Error(`Error during AI client call: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle function call
     */
    private async handleFunctionCall(
        response: ModelResponse,
        context: Context,
        aiProvider: AIProvider,
        model: string,
        options: RunOptions,
        availableTools: any[],
        onToolCall: (toolName: string, params: any) => Promise<any>
    ): Promise<ModelResponse> {
        const { name, arguments: args } = response.functionCall!;

        try {
            // Parse arguments if string, otherwise use as is
            const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;

            // Tool call logging
            if (this.debug) {
                this.logger.info(`🔧 [Tool Call] ${name}`, parsedArgs);
            }

            // Call tool
            const toolResult = await onToolCall(name, parsedArgs);

            // Tool result logging
            if (this.debug) {
                this.logger.info(`✅ [Tool Result] ${name}`, toolResult);
            }

            // Add function call result to messages
            const functionResultMessage: UniversalMessage = {
                role: 'tool',
                name: name,
                content: JSON.stringify(toolResult),
                timestamp: new Date(),
                toolResult: {
                    name,
                    result: toolResult
                }
            };

            // Create new context (original + assistant response + function result)
            const newContext: Context = {
                ...context,
                messages: [
                    ...context.messages,
                    {
                        role: 'assistant',
                        content: response.content || '',
                        functionCall: response.functionCall,
                        timestamp: new Date()
                    },
                    functionResultMessage
                ]
            };

            // Generate final response including function result
            const finalResponse = await aiProvider.chat(model, newContext, {
                ...options,
                temperature: options.temperature ?? this.temperature,
                maxTokens: options.maxTokens ?? this.maxTokens,
                tools: availableTools
            });

            return finalResponse;
        } catch (toolError) {
            logger.error('Error during tool call:', toolError);

            // Add tool call error as function result
            const errorMessage: UniversalMessage = {
                role: 'tool',
                name: name,
                content: JSON.stringify({ error: toolError instanceof Error ? toolError.message : String(toolError) }),
                timestamp: new Date(),
                toolResult: {
                    name,
                    error: toolError instanceof Error ? toolError.message : String(toolError)
                }
            };

            const errorContext: Context = {
                ...context,
                messages: [
                    ...context.messages,
                    {
                        role: 'assistant',
                        content: response.content || '',
                        functionCall: response.functionCall,
                        timestamp: new Date()
                    },
                    errorMessage
                ]
            };

            // Generate response including error
            const errorResponse = await aiProvider.chat(model, errorContext, {
                ...options,
                temperature: options.temperature ?? this.temperature,
                maxTokens: options.maxTokens ?? this.maxTokens,
                tools: availableTools
            });

            return errorResponse;
        }
    }

    /**
     * Generate streaming response
     */
    async generateStream(
        aiProvider: AIProvider,
        model: string,
        context: Context,
        options: RunOptions = {},
        availableTools: any[] = []
    ): Promise<AsyncIterable<StreamingResponseChunk>> {
        if (!aiProvider.chatStream) {
            throw new Error(`AI provider does not support streaming.`);
        }

        try {
            return aiProvider.chatStream(model, context, {
                ...options,
                temperature: options.temperature ?? this.temperature,
                maxTokens: options.maxTokens ?? this.maxTokens,
                tools: availableTools
            });
        } catch (error) {
            this.logger.error('Error occurred during streaming API call:', error);
            throw new Error(`Error during streaming API call: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
} 