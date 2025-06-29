/**
 * Anthropic API-specific type definitions
 * 
 * This file contains type definitions specific to Anthropic's Claude API,
 * ensuring complete type safety without any/unknown types.
 */

// Anthropic Message Types
export interface AnthropicMessage {
    id: string;
    type: 'message';
    role: 'assistant' | 'user';
    content: AnthropicContent[];
    model: string;
    stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
    stop_sequence: string | null;
    usage: AnthropicUsage;
}

export interface AnthropicContent {
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, string | number | boolean | object>;
}

export interface AnthropicUsage {
    input_tokens: number;
    output_tokens: number;
}

// Request Types
export interface AnthropicChatRequestParams {
    model: string;
    max_tokens: number;
    messages: AnthropicRequestMessage[];
    system?: string;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    stop_sequences?: string[];
    tools?: AnthropicTool[];
    stream?: false;
}

export interface AnthropicStreamRequestParams extends Omit<AnthropicChatRequestParams, 'stream'> {
    stream: true;
}

export interface AnthropicRequestMessage {
    role: 'user' | 'assistant';
    content: string | AnthropicRequestContent[];
}

export interface AnthropicRequestContent {
    type: 'text' | 'tool_use' | 'tool_result';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, string | number | boolean | object>;
    content?: string;
    tool_use_id?: string;
}

// Tool Types
export interface AnthropicTool {
    name: string;
    description?: string;
    input_schema: {
        type: 'object';
        properties: Record<string, AnthropicToolProperty>;
        required?: string[];
    };
}

export interface AnthropicToolProperty {
    type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
    description?: string;
    enum?: string[];
    items?: AnthropicToolProperty;
    properties?: Record<string, AnthropicToolProperty>;
}

export interface AnthropicToolCall {
    id: string;
    type: 'tool_use';
    name: string;
    input: Record<string, string | number | boolean | object>;
}

// Streaming Types
export interface AnthropicStreamChunk {
    type: 'message_start' | 'message_delta' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_stop';
    message?: Partial<AnthropicMessage>;
    delta?: AnthropicStreamDelta;
    content_block?: AnthropicContent;
    index?: number;
}

export interface AnthropicStreamDelta {
    type?: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
    stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
    stop_sequence?: string;
}

// Error Types
export interface AnthropicError {
    type: 'error';
    error: {
        type: 'invalid_request_error' | 'authentication_error' | 'permission_error' | 'not_found_error' | 'rate_limit_error' | 'api_error' | 'overloaded_error';
        message: string;
        param?: string;
        code?: string;
    };
}

// Provider Configuration
export interface AnthropicLogData {
    model: string;
    messagesCount: number;
    hasTools: boolean;
    maxTokens?: number;
    temperature?: number;
    timestamp: string;
    requestId?: string;
    usage?: AnthropicUsage;
}

// Response Types for Internal Processing
export interface AnthropicProviderResponse {
    message: AnthropicMessage;
    usage: AnthropicUsage;
    model: string;
}

// Stream Handler Types
export interface AnthropicStreamContext {
    currentMessage: string;
    currentToolCalls: AnthropicToolCall[];
    isComplete: boolean;
    usage?: AnthropicUsage;
} 