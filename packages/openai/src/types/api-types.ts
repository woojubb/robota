import type OpenAI from 'openai';

/**
 * OpenAI API Request Parameters
 * Replaces any types with specific OpenAI API structure
 */
export interface OpenAIChatRequestParams {
    model: string;
    messages: OpenAI.Chat.ChatCompletionMessageParam[];
    temperature?: number | undefined;
    max_tokens?: number | undefined;
    tools?: OpenAI.Chat.ChatCompletionTool[] | undefined;
    tool_choice?: 'auto' | 'none' | OpenAI.Chat.ChatCompletionNamedToolChoice | undefined;
    stream?: boolean | undefined;
}

/**
 * OpenAI API streaming request parameters
 */
export interface OpenAIStreamRequestParams extends Omit<OpenAIChatRequestParams, 'stream'> {
    stream: true;
}

/**
 * OpenAI API tool call structure
 */
export interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

/**
 * OpenAI API message structure with tool calls
 */
export interface OpenAIAssistantMessage {
    role: 'assistant';
    content: string | null;
    tool_calls?: OpenAIToolCall[];
}

/**
 * OpenAI API tool message structure
 */
export interface OpenAIToolMessage {
    role: 'tool';
    content: string;
    tool_call_id: string;
}

/**
 * OpenAI streaming chunk delta structure
 */
export interface OpenAIStreamDelta {
    role?: 'assistant';
    content?: string | null;
    tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
            name?: string;
            arguments?: string;
        };
    }>;
}

/**
 * OpenAI streaming chunk structure
 */
export interface OpenAIStreamChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: Array<{
        index: number;
        delta: OpenAIStreamDelta;
        finish_reason?: string | null;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * OpenAI error structure for type-safe error handling
 */
export interface OpenAIError {
    message: string;
    type?: string;
    param?: string | null;
    code?: string | null;
}

/**
 * Payload logging data structure
 */
export interface OpenAILogData {
    model: string;
    messagesCount: number;
    hasTools: boolean;
    temperature?: number | undefined;
    maxTokens?: number | undefined;
    timestamp: string;
    requestId?: string | undefined;
} 