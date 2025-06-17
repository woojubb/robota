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
    toolCalls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
    toolCallId?: string;
}

/**
 * Response from AI model
 * 
 * Contains the generated content, usage statistics, and metadata from AI provider.
 * Also includes tool calling information when applicable.
 * 
 * @public
 */
export interface ModelResponse {
    /** Generated text content (may be null for tool-only responses) */
    content?: string;

    /** Token usage statistics from the AI provider */
    usage?: {
        /** Number of tokens in the input prompt */
        promptTokens: number;
        /** Number of tokens in the generated completion */
        completionTokens: number;
        /** Total tokens used (prompt + completion) */
        totalTokens: number;
    };

    /** Provider-specific metadata */
    metadata?: {
        /** Model name used for generation */
        model?: string;
        /** Reason why generation finished */
        finishReason?: string;
        /** Provider-specific system fingerprint */
        systemFingerprint?: string;
        /** Additional provider-specific data */
        [key: string]: any;
    };

    /** Tool calls made by the assistant (OpenAI tool calling format) */
    toolCalls?: Array<{
        /** Unique identifier for this tool call */
        id: string;
        /** Type of tool call (currently only 'function' is supported) */
        type: 'function';
        /** Function call details */
        function: {
            /** Name of the function to call */
            name: string;
            /** Function arguments as JSON string */
            arguments: string;
        };
    }>;
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