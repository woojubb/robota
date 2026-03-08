/**
 * Message creation helpers and retry utilities for ConversationService.
 *
 * Extracted from conversation-service/index.ts to keep each file under 300 lines.
 * @internal
 */
import type { IAssistantMessage, ISystemMessage, IToolCall, IToolMessage, IUserMessage } from '../../interfaces/messages';
import type { TUniversalValue } from '../../interfaces/types';
import type { IRawProviderResponse } from '../../interfaces/provider';
import type { IConversationResponse, IStreamingChunk, IConversationServiceOptions, TConversationContextMetadata } from '../../interfaces/service';
import { NetworkError } from '../../utils/errors';
import type { ILogger } from '../../utils/logger';

/** @internal */
export function createUserMessageStatic(content: string, metadata?: Record<string, string | number | boolean>): IUserMessage {
    return { role: 'user', content, timestamp: new Date(), metadata: { timestamp: new Date().toISOString(), ...metadata } };
}

/** @internal */
export function createAssistantMessageStatic(response: IConversationResponse, metadata?: Record<string, string | number | boolean>): IAssistantMessage {
    const message: IAssistantMessage = {
        role: 'assistant', content: response.content, timestamp: new Date(),
        metadata: { timestamp: new Date().toISOString(), ...(response.usage && { usage: JSON.stringify(response.usage) }), ...(response.finishReason && { finishReason: response.finishReason }), ...metadata }
    };
    if (response.toolCalls && response.toolCalls.length > 0) message.toolCalls = response.toolCalls;
    return message;
}

/** @internal */
export function createSystemMessageStatic(content: string, metadata?: Record<string, string | number | boolean>): ISystemMessage {
    return { role: 'system', content, timestamp: new Date(), metadata: { timestamp: new Date().toISOString(), ...metadata } };
}

/** @internal */
export function createToolMessageStatic(toolCallId: string, result: TUniversalValue, metadata?: Record<string, string | number | boolean>): IToolMessage {
    return { role: 'tool', content: typeof result === 'string' ? result : JSON.stringify(result), toolCallId, timestamp: new Date(), metadata: { timestamp: new Date().toISOString(), ...metadata } };
}

/** Convert complex metadata to simple provider request format. @internal */
export function convertToProviderMetadata(metadata?: TConversationContextMetadata): Record<string, string | number | boolean> | undefined {
    if (!metadata) return undefined;
    const converted: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') converted[key] = value;
        else if (value instanceof Date) converted[key] = value.toISOString();
        else converted[key] = JSON.stringify(value);
    }
    return converted;
}

/** Convert optional usage to required format. @internal */
export function convertUsage(usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }): { promptTokens: number; completionTokens: number; totalTokens: number } | undefined {
    if (!usage) return undefined;
    if (typeof usage.promptTokens === 'number' && typeof usage.completionTokens === 'number' && typeof usage.totalTokens === 'number') return { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens };
    return undefined;
}

/** Process raw provider response. @internal */
export function processProviderResponse(response: IRawProviderResponse): IConversationResponse {
    const usage = convertUsage(response.usage);
    return { content: response.content || '', toolCalls: response.toolCalls || [], metadata: response.metadata || {}, finishReason: response.finishReason || 'stop', ...(usage && { usage }) };
}

/** Process a streaming chunk. @internal */
export function processStreamingChunk(chunk: { delta?: string; done?: boolean; toolCalls?: IToolCall[]; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }): IStreamingChunk {
    const usage = convertUsage(chunk.usage);
    return { delta: chunk.delta || '', done: chunk.done || false, toolCalls: chunk.toolCalls || [], ...(usage && { usage }) };
}

/** Execute with retry logic. @internal */
export async function executeWithRetry<T>(fn: () => Promise<T>, operation: string, options: Required<IConversationServiceOptions>, logger: ILogger): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
        try {
            const result = await withTimeout(fn(), options.timeout);
            if (attempt > 1) logger.info(`${operation} succeeded on attempt ${attempt}`);
            return result;
        } catch (error) {
            lastError = error as Error;
            if (attempt === options.maxRetries || !shouldRetryError(lastError)) break;
            logger.warn(`${operation} failed on attempt ${attempt}, retrying...`, { attempt, maxRetries: options.maxRetries, error: lastError.message, retryDelay: options.retryDelay });
            await delay(options.retryDelay);
        }
    }
    if (lastError) { logger.error(`${operation} failed after ${options.maxRetries} attempts`, { error: lastError.message }); throw lastError; }
    throw new Error(`${operation} failed with no error details`);
}

function shouldRetryError(error: Error): boolean {
    if (error instanceof NetworkError) return true;
    if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) return true;
    if (error.message.includes('rate limit') || error.message.includes('429')) return true;
    return false;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([promise, new Promise<T>((_, reject) => { setTimeout(() => { reject(new NetworkError(`Operation timed out after ${timeoutMs}ms`)); }, timeoutMs); })]);
}

function delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
