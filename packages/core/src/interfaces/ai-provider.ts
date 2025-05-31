import type { FunctionCall } from '@robota-sdk/tools';
import type { UniversalMessage } from '../conversation-history';

/**
 * Message role type
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'function';

/**
 * Basic message interface
 */
export interface Message {
    role: MessageRole;
    content: string;
    name?: string;
    functionCall?: FunctionCall;
    functionResult?: any;
}

/**
 * Model response interface
 */
export interface ModelResponse {
    content?: string;
    functionCall?: FunctionCall;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    metadata?: Record<string, any>;
}

/**
 * Streaming response chunk interface
 */
export interface StreamingResponseChunk {
    content?: string;
    functionCall?: Partial<FunctionCall>;
    isComplete?: boolean;
}

/**
 * Conversation context interface
 */
export interface Context {
    messages: UniversalMessage[];
    systemPrompt?: string;
    systemMessages?: Message[];
    metadata?: Record<string, any>;
}

/**
 * AI provider interface (unified wrapper)
 */
export interface AIProvider {
    /** Provider name */
    name: string;

    /** Chat request */
    chat(model: string, context: Context, options?: any): Promise<ModelResponse>;

    /** Streaming chat request (optional) */
    chatStream?(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown>;

    /** Resource cleanup (optional) */
    close?(): Promise<void>;
}

export interface ToolResult {
    name: string;
    result: any;
} 