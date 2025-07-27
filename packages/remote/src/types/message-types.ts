/**
 * Message Types - Atomic Type Definitions
 * 
 * Single responsibility: Define only message-related types
 */

// Basic message interface
export interface BasicMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | null;
}

// Request message with metadata
export interface RequestMessage extends BasicMessage {
    provider: string;
    model: string;
}

// Response message with metadata  
export interface ResponseMessage extends BasicMessage {
    timestamp: Date;
    provider?: string;
    model?: string;
    /** Tool calls made by the assistant (OpenAI tool calling format) */
    toolCalls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

// Token usage information
export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

// Enhanced response with usage
export interface EnhancedResponseMessage extends ResponseMessage {
    usage?: TokenUsage;
    tools?: Array<Record<string, string>>;
} 