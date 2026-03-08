/**
 * Anthropic API-specific type definitions
 * 
 * This file contains type definitions specific to Anthropic's Claude API,
 * ensuring complete type safety without any/unknown types.
 */

// Anthropic Message Types
export interface IAnthropicMessage {
    id: string;
    type: 'message';
    role: 'assistant' | 'user';
    content: IAnthropicContent[];
    model: string;
    stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
    stop_sequence: string | null;
    usage: IAnthropicUsage;
}

export interface IAnthropicContent {
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, string | number | boolean | object>;
}

export interface IAnthropicUsage {
    input_tokens: number;
    output_tokens: number;
}

// Request Types
export interface IAnthropicChatRequestParams {
    model: string;
    max_tokens: number;
    messages: IAnthropicRequestMessage[];
    system?: string;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    stop_sequences?: string[];
    tools?: IAnthropicTool[];
    stream?: false;
}

export interface IAnthropicStreamRequestParams extends Omit<IAnthropicChatRequestParams, 'stream'> {
    stream: true;
}

export interface IAnthropicRequestMessage {
    role: 'user' | 'assistant';
    content: string | IAnthropicRequestContent[];
}

export interface IAnthropicRequestContent {
    type: 'text' | 'tool_use' | 'tool_result';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, string | number | boolean | object>;
    content?: string;
    tool_use_id?: string;
}

// Tool Types
export interface IAnthropicTool {
    name: string;
    description?: string;
    input_schema: {
        type: 'object';
        properties: Record<string, IAnthropicToolProperty>;
        required?: string[];
    };
}

export interface IAnthropicToolProperty {
    type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
    description?: string;
    enum?: string[];
    items?: IAnthropicToolProperty;
    properties?: Record<string, IAnthropicToolProperty>;
}

export interface IAnthropicToolCall {
    id: string;
    type: 'tool_use';
    name: string;
    input: Record<string, string | number | boolean | object>;
}

// Streaming Types
export interface IAnthropicStreamChunk {
    type: 'message_start' | 'message_delta' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_stop';
    message?: Partial<IAnthropicMessage>;
    delta?: IAnthropicStreamDelta;
    content_block?: IAnthropicContent;
    index?: number;
}

export interface IAnthropicStreamDelta {
    type?: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
    stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
    stop_sequence?: string;
}

// Error Types
export interface IAnthropicError {
    type: 'error';
    error: {
        type: 'invalid_request_error' | 'authentication_error' | 'permission_error' | 'not_found_error' | 'rate_limit_error' | 'api_error' | 'overloaded_error';
        message: string;
        param?: string;
        code?: string;
    };
}

// Provider Configuration
export interface IAnthropicLogData {
    model: string;
    messagesCount: number;
    hasTools: boolean;
    maxTokens?: number;
    temperature?: number;
    timestamp: string;
    requestId?: string;
    usage?: IAnthropicUsage;
}

// Response Types for Internal Processing
export interface IAnthropicProviderResponse {
    message: IAnthropicMessage;
    usage: IAnthropicUsage;
    model: string;
}

// Stream Handler Types
export interface IAnthropicStreamContext {
    currentMessage: string;
    currentToolCalls: IAnthropicToolCall[];
    isComplete: boolean;
    usage?: IAnthropicUsage;
} 