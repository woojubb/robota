/**
 * Message Types - Atomic Type Definitions
 * 
 * Single responsibility: Define only message-related types
 */

// Basic message structure
export interface BasicMessage {
    role: string;
    content: string;
}

// Request message with provider info
export interface RequestMessage extends BasicMessage {
    provider: string;
    model: string;
}

// Response message with metadata
export interface ResponseMessage extends BasicMessage {
    timestamp: Date;
    provider?: string;
    model?: string;
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