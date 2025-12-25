/**
 * Message Types - Atomic Type Definitions
 * 
 * Single responsibility: Define only message-related types
 */

import type { IToolCall } from '@robota-sdk/agents';

// Basic message interface
export interface IBasicMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | null;
}

// Request message with metadata
export interface IRequestMessage extends IBasicMessage {
    provider: string;
    model: string;
}

// Response message with metadata  
export interface IResponseMessage extends IBasicMessage {
    timestamp: Date;
    provider?: string;
    model?: string;
    /** Tool calls made by the assistant (OpenAI tool calling format) */
    toolCalls?: IToolCall[];
}

// Token usage information
export interface ITokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

// Enhanced response with usage
export interface IEnhancedResponseMessage extends IResponseMessage {
    usage?: ITokenUsage;
    tools?: Array<Record<string, string>>;
} 