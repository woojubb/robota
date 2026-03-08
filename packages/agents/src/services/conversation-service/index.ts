/**
 * Conversation Service - handles AI provider interactions and response processing.
 *
 * Message creation and retry helpers live in ./message-helpers.ts.
 * @internal
 */
import type { IAssistantMessage, ISystemMessage, IToolMessage, IUserMessage, TUniversalMessage } from '../../interfaces/messages';
import type { IAIProvider, IProviderRequest } from '../../interfaces/provider';
import type { TUniversalValue } from '../../interfaces/types';
import { ProviderError } from '../../utils/errors';
import { createLogger, type ILogger } from '../../utils/logger';
import { IConversationContext, IConversationResponse, IStreamingChunk, IConversationServiceOptions, IContextOptions, IConversationService } from '../../interfaces/service';
import {
    createUserMessageStatic, createAssistantMessageStatic, createSystemMessageStatic, createToolMessageStatic,
    convertToProviderMetadata, processProviderResponse, processStreamingChunk, executeWithRetry
} from './message-helpers';

const DEFAULT_OPTIONS: Required<IConversationServiceOptions> = {
    maxHistoryLength: 100, enableRetry: true, maxRetries: 3, retryDelay: 1000, timeout: 30000,
};

interface IConversationProviderRequest extends IProviderRequest {
    model: string;
    stream?: boolean;
}

/** @internal */
export class ConversationService implements IConversationService {

    prepareContext(messages: TUniversalMessage[], model: string, provider: string, contextOptions: IContextOptions = {}, serviceOptions: IConversationServiceOptions = {}): IConversationContext {
        return this.buildContext(messages, model, provider, contextOptions, serviceOptions, createLogger('ConversationService'));
    }

    async generateResponse(provider: IAIProvider, context: IConversationContext, serviceOptions: IConversationServiceOptions = {}): Promise<IConversationResponse> {
        const logger = createLogger('ConversationService');
        const options = { ...DEFAULT_OPTIONS, ...serviceOptions };
        const startTime = Date.now();
        try {
            const request = this.createProviderRequest(context);
            const response = await executeWithRetry(() => provider.generateResponse(request), `generateResponse for ${context.provider}:${context.model}`, options, logger);
            const processed = processProviderResponse(response);
            logger.info('Response generated successfully', { provider: context.provider, model: context.model, duration: Date.now() - startTime, usage: processed.usage });
            return processed;
        } catch (error) {
            logger.error('Response generation failed', { provider: context.provider, model: context.model, duration: Date.now() - startTime, error: error instanceof Error ? error.message : String(error) });
            if (error instanceof ProviderError) throw error;
            throw new ProviderError(`Response generation failed: ${error instanceof Error ? error.message : String(error)}`, context.provider, error instanceof Error ? error : undefined);
        }
    }

    async* generateStreamingResponse(provider: IAIProvider, context: IConversationContext, _serviceOptions: IConversationServiceOptions = {}): AsyncGenerator<IStreamingChunk, void, undefined> {
        const logger = createLogger('ConversationService');
        const startTime = Date.now();
        try {
            const request = this.createProviderRequest(context, true);
            if (!provider.generateStreamingResponse) throw new ProviderError(`Provider does not support streaming`, context.provider);
            const stream = provider.generateStreamingResponse(request);
            let chunkCount = 0;
            for await (const chunk of stream) {
                chunkCount++;
                const processed = processStreamingChunk(chunk);
                yield processed;
                if (processed.done) break;
            }
            logger.info('Streaming response completed', { provider: context.provider, model: context.model, duration: Date.now() - startTime, totalChunks: chunkCount });
        } catch (error) {
            logger.error('Streaming response failed', { provider: context.provider, model: context.model, duration: Date.now() - startTime, error: error instanceof Error ? error.message : String(error) });
            if (error instanceof ProviderError) throw error;
            throw new ProviderError(`Streaming response failed: ${error instanceof Error ? error.message : String(error)}`, context.provider, error instanceof Error ? error : undefined);
        }
    }

    validateContext(context: IConversationContext): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];
        if (!context.messages || !Array.isArray(context.messages)) errors.push('Messages must be an array');
        else if (context.messages.length === 0) errors.push('At least one message is required');
        if (!context.model || typeof context.model !== 'string') errors.push('Model must be a non-empty string');
        if (!context.provider || typeof context.provider !== 'string') errors.push('Provider must be a non-empty string');
        if (context.temperature !== undefined && (typeof context.temperature !== 'number' || context.temperature < 0 || context.temperature > 2)) errors.push('Temperature must be a number between 0 and 2');
        if (context.maxTokens !== undefined && (typeof context.maxTokens !== 'number' || context.maxTokens <= 0)) errors.push('MaxTokens must be a positive number');
        return { isValid: errors.length === 0, errors };
    }

    createUserMessage(content: string, metadata?: Record<string, string | number | boolean>): IUserMessage { return createUserMessageStatic(content, metadata); }
    createAssistantMessage(response: IConversationResponse, metadata?: Record<string, string | number | boolean>): IAssistantMessage { return createAssistantMessageStatic(response, metadata); }
    createSystemMessage(content: string, metadata?: Record<string, string | number | boolean>): ISystemMessage { return createSystemMessageStatic(content, metadata); }
    createToolMessage(toolCallId: string, result: TUniversalValue, metadata?: Record<string, string | number | boolean>): IToolMessage { return createToolMessageStatic(toolCallId, result, metadata); }

    private buildContext(messages: TUniversalMessage[], model: string, provider: string, contextOptions: IContextOptions, serviceOptions: IConversationServiceOptions, logger: ILogger): IConversationContext {
        const options = { ...DEFAULT_OPTIONS, ...serviceOptions };
        let processed = messages;
        if (options.maxHistoryLength > 0 && messages.length > options.maxHistoryLength) {
            const system = messages.filter(m => m.role === 'system');
            const other = messages.filter(m => m.role !== 'system');
            processed = [...system, ...other.slice(-options.maxHistoryLength + system.length)];
        }
        return {
            messages: processed, model, provider,
            ...(contextOptions.systemMessage && { systemMessage: contextOptions.systemMessage }),
            ...(contextOptions.temperature !== undefined && { temperature: contextOptions.temperature }),
            ...(contextOptions.maxTokens !== undefined && { maxTokens: contextOptions.maxTokens }),
            ...(contextOptions.tools && { tools: contextOptions.tools }),
            ...(contextOptions.metadata && { metadata: contextOptions.metadata })
        };
    }

    private createProviderRequest(context: IConversationContext, streaming: boolean = false): IConversationProviderRequest {
        const metadata = convertToProviderMetadata(context.metadata);
        return {
            messages: context.messages, model: context.model, stream: streaming,
            ...(context.temperature !== undefined && { temperature: context.temperature }),
            ...(context.maxTokens !== undefined && { maxTokens: context.maxTokens }),
            ...(context.tools && { tools: context.tools }),
            ...(context.systemMessage && { systemMessage: context.systemMessage }),
            ...(metadata && { metadata })
        };
    }
}
