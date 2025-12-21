/**
 * Message Contracts (Single Source of Truth)
 *
 * IMPORTANT:
 * - This module is owned by the `interfaces` layer.
 * - All message types used across the SDK must be defined here to avoid drift.
 * - Runtime values (variables/classes/objects) and compile-time types can share the same name in TypeScript.
 *   Prefixing type aliases (`T*`) and interfaces (`I*`) reduces value/type name collision risk and review overhead.
 */

/**
 * Universal message role type - provider-independent neutral role.
 */
export type TUniversalMessageRole = 'user' | 'assistant' | 'system' | 'tool';

/** Backward-compatible alias. */
export type UniversalMessageRole = TUniversalMessageRole;

/**
 * Legacy alias kept for compatibility.
 * @deprecated Use UniversalMessageRole instead.
 */
export type MessageRole = UniversalMessageRole;

/**
 * Message metadata used across conversation history and provider adapters.
 */
export type TConversationMessageMetadata = Record<string, string | number | boolean | Date | string[] | number[]>;
export type ConversationMessageMetadata = TConversationMessageMetadata;

/**
 * Tool call (OpenAI tool calling format).
 */
export interface IToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

/** Backward-compatible alias. */
export type ToolCall = IToolCall;

/**
 * Base message contract shared by all message variants.
 */
export interface IBaseMessage {
    /** Message creation timestamp */
    timestamp: Date;
    /** Additional metadata */
    metadata?: ConversationMessageMetadata;
}

/** Backward-compatible alias. */
export type BaseMessage = IBaseMessage;

export interface IUserMessage extends IBaseMessage {
    role: 'user';
    content: string;
    name?: string;
}
export type UserMessage = IUserMessage;

export interface IAssistantMessage extends IBaseMessage {
    role: 'assistant';
    /** Assistant response content (can be null when making tool calls) */
    content: string | null;
    toolCalls?: IToolCall[];
}
export type AssistantMessage = IAssistantMessage;

export interface ISystemMessage extends IBaseMessage {
    role: 'system';
    content: string;
    name?: string;
}
export type SystemMessage = ISystemMessage;

export interface IToolMessage extends IBaseMessage {
    role: 'tool';
    content: string;
    toolCallId: string;
    name?: string;
}
export type ToolMessage = IToolMessage;

/**
 * Universal message union used across the SDK as the canonical contract.
 */
export type TUniversalMessage = IUserMessage | IAssistantMessage | ISystemMessage | IToolMessage;
export type UniversalMessage = TUniversalMessage;

/**
 * Legacy alias kept for compatibility with older call sites.
 * Prefer UniversalMessage.
 */
export type Message = UniversalMessage;


