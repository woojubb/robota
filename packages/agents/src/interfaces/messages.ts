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

/**
 * Message metadata used across conversation history and provider adapters.
 */
export type TUniversalMessageMetadata = Record<string, string | number | boolean | Date | string[] | number[]>;

/**
 * Universal multimodal message part contracts.
 */
export interface ITextMessagePart {
    type: 'text';
    text: string;
}

export interface IInlineImageMessagePart {
    type: 'image_inline';
    mimeType: string;
    data: string;
}

export interface IUriImageMessagePart {
    type: 'image_uri';
    uri: string;
    mimeType?: string;
}

export type TUniversalMessagePart = ITextMessagePart | IInlineImageMessagePart | IUriImageMessagePart;

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

/**
 * Base message contract shared by all message variants.
 */
export interface IBaseMessage {
    /** Message creation timestamp */
    timestamp: Date;
    /** Additional metadata */
    metadata?: TUniversalMessageMetadata;
}

export interface IUserMessage extends IBaseMessage {
    role: 'user';
    content: string;
    parts?: TUniversalMessagePart[];
    name?: string;
}

export interface IAssistantMessage extends IBaseMessage {
    role: 'assistant';
    /** Assistant response content (can be null when making tool calls) */
    content: string | null;
    parts?: TUniversalMessagePart[];
    toolCalls?: IToolCall[];
}

export interface ISystemMessage extends IBaseMessage {
    role: 'system';
    content: string;
    parts?: TUniversalMessagePart[];
    name?: string;
}

export interface IToolMessage extends IBaseMessage {
    role: 'tool';
    content: string;
    parts?: TUniversalMessagePart[];
    toolCallId: string;
    name?: string;
}

/**
 * Universal message union used across the SDK as the canonical contract.
 */
export type TUniversalMessage = IUserMessage | IAssistantMessage | ISystemMessage | IToolMessage;

/**
 * Type guards for the canonical TUniversalMessage union.
 *
 * NOTE:
 * - These guards are owned by the `interfaces` layer and must not depend on managers/services.
 * - Call sites should use these guards instead of importing from manager layers.
 */
export function isUserMessage(message: TUniversalMessage): message is IUserMessage {
    return message.role === 'user';
}

export function isAssistantMessage(message: TUniversalMessage): message is IAssistantMessage {
    return message.role === 'assistant';
}

export function isSystemMessage(message: TUniversalMessage): message is ISystemMessage {
    return message.role === 'system';
}

export function isToolMessage(message: TUniversalMessage): message is IToolMessage {
    return message.role === 'tool';
}



