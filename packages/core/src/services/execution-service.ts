import type { RunOptions } from '../types';
import type { Logger } from '../interfaces/logger';
import type { ModelResponse, StreamingResponseChunk } from '../interfaces/ai-provider';
import type { ConversationHistory } from '../conversation-history';

import { AIProviderManager } from '../managers/ai-provider-manager';
import { ToolProviderManager } from '../managers/tool-provider-manager';
import { SystemMessageManager } from '../managers/system-message-manager';
import { RequestLimitManager } from '../managers/request-limit-manager';
import { AnalyticsManager } from '../managers/analytics-manager';
import { TokenAnalyzer } from '../analyzers/token-analyzer';
import { ConversationService } from './conversation-service';

/**
 * Context for request execution
 */
interface ExecutionContext {
    conversationHistory: ConversationHistory;
    systemMessageManager: SystemMessageManager;
    options: RunOptions;
}

/**
 * Handles the execution logic for Robota requests
 * Follows single responsibility principle by handling only execution flow
 */
export class ExecutionService {
    constructor(
        private aiProviderManager: AIProviderManager,
        private toolProviderManager: ToolProviderManager,
        private requestLimitManager: RequestLimitManager,
        private analyticsManager: AnalyticsManager,
        private tokenAnalyzer: TokenAnalyzer,
        private conversationService: ConversationService,
        private logger: Logger,
        private debug: boolean,
        private onToolCall?: (toolName: string, params: any, result: any) => void
    ) { }

    /**
     * Execute a text prompt and return response
     */
    async executePrompt(prompt: string, context: ExecutionContext): Promise<string> {
        // Add user message to conversation history
        context.conversationHistory.addUserMessage(prompt);

        // Prepare conversation context
        const conversationContext = this.conversationService.prepareContext(
            context.conversationHistory,
            context.systemMessageManager.getSystemPrompt(),
            context.systemMessageManager.getSystemMessages(),
            context.options
        );

        // Execute the request with limits and analytics
        const response = await this.executeWithLimitsAndAnalytics(conversationContext, context.options, context.conversationHistory);

        // For non-tool calling scenarios, we need to add the assistant response to history
        // Tool calling scenarios: ConversationService handles tool messages, but ExecutionService handles final response
        const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;

        // Always store the final assistant response (whether from tool calling or regular conversation)
        if (response.content) {
            if (this.debug) {
                this.logger.info(`📝 [ExecutionService] Adding assistant response to history: ${response.content.substring(0, 100)}...`);
            }
            context.conversationHistory.addAssistantMessage(response.content);
        }

        // Debug logging
        if (this.debug) {
            if (hasToolCalls) {
                this.logger.info(`🔍 [ExecutionService] Tool calling completed. Final response: ${response.content?.substring(0, 100) || 'No content'}...`);
            } else {
                this.logger.info(`🔍 [ExecutionService] Regular conversation completed. Response: ${response.content?.substring(0, 100) || 'No content'}...`);
            }
            this.logger.info(`📊 [ExecutionService] Total messages in history: ${context.conversationHistory.getMessageCount()}`);
        }

        return response.content || '';
    }

    /**
     * Execute a streaming prompt and return response stream
     */
    async executeStream(prompt: string, context: ExecutionContext): Promise<AsyncIterable<StreamingResponseChunk>> {
        // Add user message to conversation history
        context.conversationHistory.addUserMessage(prompt);

        // Prepare conversation context
        const conversationContext = this.conversationService.prepareContext(
            context.conversationHistory,
            context.systemMessageManager.getSystemPrompt(),
            context.systemMessageManager.getSystemMessages(),
            context.options
        );

        // Note: For streaming, token counting is more complex as we need to collect all chunks
        // We'll handle analytics when the stream completes or delegate to the implementation
        return this.generateStream(conversationContext, context.options);
    }

    /**
     * Execute with request limits and analytics tracking
     */
    private async executeWithLimitsAndAnalytics(
        conversationContext: any,
        options: RunOptions,
        conversationHistory: ConversationHistory
    ): Promise<ModelResponse> {
        // Check request limit first
        this.requestLimitManager.checkRequestLimit();

        // Pre-calculate tokens to check limits before making the API call
        const currentAI = this.aiProviderManager.getCurrentAI();
        const currentModel = currentAI.model || 'unknown';

        await this.checkTokenLimits(conversationContext.messages, currentModel);

        const response = await this.generateResponse(conversationContext, options, conversationHistory);

        // Record analytics and limit data with actual token usage
        this.recordUsageAnalytics(response, currentAI.provider || 'unknown', currentModel);

        return response;
    }

    /**
     * Check token limits before making API call
     */
    private async checkTokenLimits(messages: any[], currentModel: string): Promise<void> {
        if (!this.requestLimitManager.isTokensUnlimited()) {
            try {
                // Calculate estimated tokens for the request
                const estimatedTokens = this.tokenAnalyzer.calculateMessagesTokens(
                    messages,
                    currentModel
                );

                if (this.debug) {
                    this.logger.info(`🔍 [Token Estimation] Model: ${currentModel}, Estimated tokens: ${estimatedTokens}`);
                }

                // Check if estimated tokens would exceed the limit
                this.requestLimitManager.checkEstimatedTokenLimit(estimatedTokens);
            } catch (error) {
                this.logger.error('Token limit check failed:', error);
                throw error;
            }
        }
    }

    /**
     * Record usage in analytics and limits
     */
    private recordUsageAnalytics(response: ModelResponse, provider: string, model: string): void {
        if (response.usage?.totalTokens) {
            // Record in limit manager first (this may throw if limits exceeded)
            this.requestLimitManager.recordRequest(response.usage.totalTokens);

            // Then record in analytics for historical data
            this.analyticsManager.recordRequest(
                response.usage.totalTokens,
                provider,
                model
            );
        }
    }

    /**
     * Generate response (internal use)
     */
    private async generateResponse(context: any, options: RunOptions = {}, conversationHistory: ConversationHistory): Promise<ModelResponse> {
        if (!this.aiProviderManager.isConfigured()) {
            throw new Error('Current AI provider and model are not configured. Use setCurrentAI() method to configure.');
        }

        const currentAiProvider = this.aiProviderManager.getCurrentProvider()!;
        const currentModel = this.aiProviderManager.getCurrentModel()!;

        return this.conversationService.generateResponse(
            currentAiProvider,
            currentModel,
            context,
            options,
            this.toolProviderManager.getAvailableTools(),
            async (toolName: string, params: any) => {
                const result = await this.toolProviderManager.callTool(toolName, params);

                // Execute callback
                if (this.onToolCall) {
                    this.onToolCall(toolName, params, result);
                }

                return result;
            },
            conversationHistory
        );
    }

    /**
     * Generate streaming response (internal use)
     */
    private async generateStream(context: any, options: RunOptions = {}): Promise<AsyncIterable<StreamingResponseChunk>> {
        if (!this.aiProviderManager.isConfigured()) {
            throw new Error('Current AI provider and model are not configured. Use setCurrentAI() method to configure.');
        }

        const currentAiProvider = this.aiProviderManager.getCurrentProvider()!;
        const currentModel = this.aiProviderManager.getCurrentModel()!;

        return this.conversationService.generateStream(
            currentAiProvider,
            currentModel,
            context,
            options,
            this.toolProviderManager.getAvailableTools()
        );
    }
} 