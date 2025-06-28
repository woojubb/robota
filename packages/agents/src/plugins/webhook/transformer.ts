/**
 * Webhook data transformation utilities
 * Converts base plugin types to webhook-specific types safely
 */

import type { BaseExecutionContext, BaseExecutionResult } from '../../abstracts/base-plugin';
import type {
    WebhookExecutionContext,
    WebhookExecutionResult,
    WebhookEventData,
    WebhookExecutionData,
    WebhookConversationData,
    WebhookToolData,
    WebhookErrorData,
    WebhookToolCallData
} from './types';

/**
 * Webhook data transformer utility class
 */
export class WebhookTransformer {
    /**
     * Convert BaseExecutionContext to WebhookExecutionContext
     */
    static contextToWebhook(context: BaseExecutionContext): WebhookExecutionContext {
        return {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId
        };
    }

    /**
     * Convert BaseExecutionResult to WebhookExecutionResult
     */
    static resultToWebhook(result: BaseExecutionResult): WebhookExecutionResult {
        return {
            response: result.response,
            content: result.content,
            duration: result.duration,
            tokensUsed: result.tokensUsed,
            toolsExecuted: result.toolsExecuted,
            success: result.success,
            usage: result.usage,
            toolCalls: result.toolCalls,
            error: result.error
        };
    }

    /**
     * Create execution event data
     */
    static createExecutionData(
        context: WebhookExecutionContext,
        result: WebhookExecutionResult
    ): WebhookEventData {
        const executionData: WebhookExecutionData = {
            response: result.response || undefined,
            duration: result.duration || undefined,
            tokensUsed: result.tokensUsed || undefined,
            toolsExecuted: result.toolsExecuted || undefined,
            success: result.success !== undefined ? result.success : undefined
        };

        return {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            result: executionData
        };
    }

    /**
     * Create conversation event data
     */
    static createConversationData(
        context: WebhookExecutionContext,
        result: WebhookExecutionResult
    ): WebhookEventData {
        const toolCalls: WebhookToolCallData[] = result.toolCalls?.map(call => ({
            id: call.id || '',
            name: call.name || '',
            arguments: JSON.stringify(call.arguments || {}),
            result: String(call.result || '')
        })) || [];

        const conversationData: WebhookConversationData = {
            response: result.content || result.response || undefined,
            tokensUsed: result.usage?.totalTokens || result.tokensUsed || undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        };

        return {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            conversation: conversationData
        };
    }

    /**
     * Create tool execution event data
     */
    static createToolData(
        context: WebhookExecutionContext,
        toolResult: any
    ): WebhookEventData {
        // Safely extract tool data from result
        const toolName = this.safeGetProperty(toolResult, 'toolName') || 'unknown';
        const toolId = this.safeGetProperty(toolResult, 'toolId') ||
            this.safeGetProperty(toolResult, 'executionId') || 'unknown';
        const hasError = this.safeGetProperty(toolResult, 'error');
        const duration = this.safeGetProperty(toolResult, 'duration');
        const result = this.safeGetProperty(toolResult, 'result');

        const toolData: WebhookToolData = {
            name: String(toolName),
            id: String(toolId),
            success: !hasError,
            duration: typeof duration === 'number' ? duration : undefined,
            result: hasError ? undefined : String(result || ''),
            error: hasError ? (hasError instanceof Error ? hasError.message : String(hasError)) : undefined
        };

        return {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            tool: toolData
        };
    }

    /**
     * Create error event data
     */
    static createErrorData(
        context: WebhookExecutionContext,
        error: Error
    ): WebhookEventData {
        const errorData: WebhookErrorData = {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            type: error instanceof Error ? error.constructor.name : 'Unknown',
            context: context ? {
                executionId: context.executionId || '',
                sessionId: context.sessionId || '',
                userId: context.userId || ''
            } : undefined
        };

        return {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            error: errorData
        };
    }

    /**
     * Safely get property from object (handles index signature issues)
     */
    private static safeGetProperty(obj: any, key: string): any {
        if (!obj || typeof obj !== 'object') {
            return undefined;
        }
        return obj[key];
    }

    /**
     * Default payload transformer for webhook events
     */
    static defaultPayloadTransformer(
        _event: string,
        data: WebhookEventData
    ): WebhookEventData {
        // Simply return the data as-is for the default transformer
        return data;
    }
} 