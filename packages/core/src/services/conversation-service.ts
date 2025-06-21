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
     * @param conversationHistory - Conversation history to store messages sequentially
     */
    async generateResponse(
        aiProvider: AIProvider,
        model: string,
        context: Context,
        options: RunOptions = {},
        availableTools: any[] = [],
        onToolCall?: (toolName: string, params: any) => Promise<any>,
        conversationHistory?: ConversationHistory
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

            // Automatically execute if there are tool calls
            if (onToolCall && response.toolCalls && response.toolCalls.length > 0) {
                return await this.handleToolCalls(
                    response,
                    context,
                    aiProvider,
                    model,
                    options,
                    availableTools,
                    onToolCall,
                    conversationHistory
                );
            }

            return response;
        } catch (error) {
            logger.error('Error occurred during AI client call:', error);
            throw new Error(`Error during AI client call: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle function call (simplified - only tool_calls format)
     */
    private async handleFunctionCall(
        response: ModelResponse,
        context: Context,
        aiProvider: AIProvider,
        model: string,
        options: RunOptions,
        availableTools: any[],
        onToolCall: (toolName: string, params: any) => Promise<any>,
        conversationHistory?: ConversationHistory
    ): Promise<ModelResponse> {
        // Only handle new tool_calls format
        if (response.toolCalls && response.toolCalls.length > 0) {
            return await this.handleToolCalls(
                response,
                context,
                aiProvider,
                model,
                options,
                availableTools,
                onToolCall,
                conversationHistory
            );
        }

        return response;
    }

    /**
     * Handle new tool_calls format (OpenAI tool calling)
     */
    private async handleToolCalls(
        response: ModelResponse,
        context: Context,
        aiProvider: AIProvider,
        model: string,
        options: RunOptions,
        availableTools: any[],
        onToolCall: (toolName: string, params: any) => Promise<any>,
        conversationHistory?: ConversationHistory
    ): Promise<ModelResponse> {
        const toolCalls = response.toolCalls!;

        // Create assistant message with tool calls - MUST include toolCalls property
        const assistantMessage: UniversalMessage = {
            role: 'assistant',
            content: response.content || null,
            timestamp: new Date(),
            toolCalls: toolCalls.map(tc => ({
                id: tc.id,
                type: tc.type,
                function: tc.function
            }))
        };

        // Debug: Log the assistant message being created
        if (this.debug) {
            this.logger.info('🔍 [Debug] Assistant message created:', {
                role: assistantMessage.role,
                content: assistantMessage.content,
                hasToolCalls: !!(assistantMessage as any).toolCalls,
                toolCallsCount: (assistantMessage as any).toolCalls?.length || 0,
                toolCallIds: (assistantMessage as any).toolCalls?.map((tc: any) => tc.id) || []
            });
        }

        // STEP 1: Store assistant message with tool calls in conversation history immediately
        if (conversationHistory) {
            if (this.debug) {
                this.logger.info('📝 [ConversationService] Storing assistant message with tool calls');
            }
            conversationHistory.addAssistantMessage(
                assistantMessage.content || '',
                assistantMessage.toolCalls
            );
        }

        // Get parallel tool call settings from AI provider options (with defaults)
        const enableParallel = (aiProvider as any).options?.enableParallelToolCalls ?? true;
        const maxConcurrent = (aiProvider as any).options?.maxConcurrentToolCalls ?? 3;
        const delayMs = (aiProvider as any).options?.toolCallDelayMs ?? 100;

        if (this.debug) {
            this.logger.info('🔧 [Tool Call Settings]:', {
                enableParallel,
                maxConcurrent,
                delayMs,
                toolCallsCount: toolCalls.length
            });
        }

        // Execute tool calls (parallel or sequential based on settings)
        let toolResultMessages: UniversalMessage[] = [];

        if (enableParallel && toolCalls.length > 1) {
            // Parallel execution with rate limiting
            toolResultMessages = await this.executeToolCallsInParallel(
                toolCalls,
                onToolCall,
                maxConcurrent,
                delayMs,
                conversationHistory
            );
        } else {
            // Sequential execution (original behavior)
            toolResultMessages = await this.executeToolCallsSequentially(
                toolCalls,
                onToolCall,
                conversationHistory
            );
        }

        // Create new context with ALL messages included (for the final AI call)
        const newContext: Context = {
            ...context,
            messages: [
                ...context.messages,
                assistantMessage,  // Assistant message with tool_calls
                ...toolResultMessages  // Tool result messages with toolCallId
            ]
        };

        // Debug: Log the messages that will be sent
        if (this.debug) {
            this.logger.info('🔍 [Debug] Messages in new context:', newContext.messages.length);
            newContext.messages.slice(-10).forEach((msg, idx) => {
                const displayIdx = newContext.messages.length - 10 + idx + 1;
                if (msg.role === 'tool') {
                    this.logger.info(`  ${displayIdx}. ${msg.role}: [tool_call_id: ${(msg as any).toolCallId}]`);
                } else if (msg.role === 'assistant' && (msg as any).toolCalls) {
                    this.logger.info(`  ${displayIdx}. ${msg.role}: [has ${(msg as any).toolCalls.length} tool calls]`);
                } else {
                    this.logger.info(`  ${displayIdx}. ${msg.role}: ${msg.content?.substring(0, 50) || ''}...`);
                }
            });
        }

        // Generate final response including tool results
        const finalResponse = await aiProvider.chat(model, newContext, {
            ...options,
            temperature: options.temperature ?? this.temperature,
            maxTokens: options.maxTokens ?? this.maxTokens,
            tools: availableTools,
            functionCallMode: 'disabled' // Prevent recursive tool calls
        });

        // STEP 3: Final assistant response will be stored by ExecutionService
        // We don't store it here to avoid duplication

        // Return final response (no need for intermediateMessages anymore)
        return finalResponse;
    }

    /**
     * Execute tool calls in parallel with rate limiting
     */
    private async executeToolCallsInParallel(
        toolCalls: any[],
        onToolCall: (toolName: string, params: any) => Promise<any>,
        maxConcurrent: number,
        delayMs: number,
        conversationHistory?: ConversationHistory
    ): Promise<UniversalMessage[]> {
        const toolResultMessages: UniversalMessage[] = [];

        if (this.debug) {
            this.logger.info(`🚀 [Parallel Tool Execution] Processing ${toolCalls.length} tool calls in batches of ${maxConcurrent}`);
        }

        // Process tool calls in batches to respect maxConcurrent limit
        for (let i = 0; i < toolCalls.length; i += maxConcurrent) {
            const batch = toolCalls.slice(i, i + maxConcurrent);

            if (this.debug) {
                this.logger.info(`📦 [Batch ${Math.floor(i / maxConcurrent) + 1}] Processing ${batch.length} tool calls`);
            }

            // Execute batch with staggered delays to avoid rate limits
            const batchPromises = batch.map(async (toolCall, index) => {
                // Apply staggered delay to avoid hitting rate limits
                if (index > 0) {
                    await this.delay(delayMs * index);
                }

                return this.executeSingleToolCall(toolCall, onToolCall, conversationHistory);
            });

            // Wait for all tool calls in this batch to complete
            const batchResults = await Promise.all(batchPromises);
            toolResultMessages.push(...batchResults);

            // Add delay between batches if there are more batches to process
            if (i + maxConcurrent < toolCalls.length) {
                if (this.debug) {
                    this.logger.info(`⏱️ [Batch Delay] Waiting ${delayMs}ms before next batch`);
                }
                await this.delay(delayMs);
            }
        }

        if (this.debug) {
            this.logger.info(`✅ [Parallel Tool Execution] Completed all ${toolCalls.length} tool calls`);
        }

        return toolResultMessages;
    }

    /**
     * Execute tool calls sequentially (original behavior)
     */
    private async executeToolCallsSequentially(
        toolCalls: any[],
        onToolCall: (toolName: string, params: any) => Promise<any>,
        conversationHistory?: ConversationHistory
    ): Promise<UniversalMessage[]> {
        const toolResultMessages: UniversalMessage[] = [];

        if (this.debug) {
            this.logger.info(`🔄 [Sequential Tool Execution] Processing ${toolCalls.length} tool calls sequentially`);
        }

        for (const toolCall of toolCalls) {
            const toolResultMessage = await this.executeSingleToolCall(toolCall, onToolCall, conversationHistory);
            toolResultMessages.push(toolResultMessage);
        }

        return toolResultMessages;
    }

    /**
     * Execute a single tool call with error handling
     */
    private async executeSingleToolCall(
        toolCall: any,
        onToolCall: (toolName: string, params: any) => Promise<any>,
        conversationHistory?: ConversationHistory
    ): Promise<UniversalMessage> {
        const { name, arguments: args } = toolCall.function;
        const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;

        try {
            // Tool call logging
            if (this.debug) {
                this.logger.info(`🔧 [Tool Call] ${name} (ID: ${toolCall.id})`, parsedArgs);
            }

            // Call tool
            const toolResult = await onToolCall(name, parsedArgs);

            // Tool result logging
            if (this.debug) {
                this.logger.info(`✅ [Tool Result] ${name} (ID: ${toolCall.id})`, toolResult);
            }

            // Create tool response message with proper tool_call_id
            const toolResponseMessage: UniversalMessage = {
                role: 'tool',
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
                timestamp: new Date(),
                toolCallId: toolCall.id, // This is crucial for OpenAI
                name: name
            };

            // STEP 2: Store tool result message in conversation history immediately
            if (conversationHistory) {
                if (this.debug) {
                    this.logger.info(`📝 [ConversationService] Storing tool result message (ID: ${toolCall.id})`);
                }
                conversationHistory.addToolMessageWithId(
                    toolResponseMessage.content,
                    toolCall.id,
                    name
                );
            }

            return toolResponseMessage;
        } catch (toolError) {
            logger.error('Error during tool call:', toolError);

            // Add tool call error as tool response
            const errorMessage: UniversalMessage = {
                role: 'tool',
                content: JSON.stringify({ error: toolError instanceof Error ? toolError.message : String(toolError) }),
                timestamp: new Date(),
                toolCallId: toolCall.id,
                name: name
            };

            // Store error message in conversation history immediately
            if (conversationHistory) {
                if (this.debug) {
                    this.logger.info(`📝 [ConversationService] Storing tool error message (ID: ${toolCall.id})`);
                }
                conversationHistory.addToolMessageWithId(
                    errorMessage.content,
                    toolCall.id,
                    name
                );
            }

            return errorMessage;
        }
    }

    /**
     * Utility function to add delay
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
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