/**
 * WebSocket Utilities - Pure Functions for Message Handling
 * 
 * Zero any/unknown types, explicit interfaces for all data structures
 */

import type { TransportRequest, ChatResponseData } from '../shared/types';

export interface WebSocketRequestPayload {
    id: string;
    type: 'request';
    data: TransportRequest;
}

export interface WebSocketResponsePayload {
    id: string;
    type: 'response';
    data: ChatResponseData;
}

export interface WebSocketErrorPayload {
    id: string;
    type: 'error';
    error: string;
    requestId?: string;
}

export interface WebSocketPingPayload {
    id: string;
    type: 'ping';
}

export interface WebSocketPongPayload {
    id: string;
    type: 'pong';
}

export interface WebSocketStreamPayload {
    id: string;
    type: 'stream';
    data: ChatResponseData;
    requestId: string;
}

export type WebSocketPayload =
    | WebSocketRequestPayload
    | WebSocketResponsePayload
    | WebSocketErrorPayload
    | WebSocketPingPayload
    | WebSocketPongPayload
    | WebSocketStreamPayload;

/**
 * Pure function to create request message
 */
export function createRequestMessage(id: string, request: TransportRequest): WebSocketRequestPayload {
    return {
        id,
        type: 'request',
        data: request
    };
}

/**
 * Pure function to create ping message
 */
export function createPingMessage(id: string): WebSocketPingPayload {
    return {
        id,
        type: 'ping'
    };
}

/**
 * Pure function to create pong message
 */
export function createPongMessage(id: string): WebSocketPongPayload {
    return {
        id,
        type: 'pong'
    };
}

/**
 * Pure function to validate WebSocket message
 */
export function validateWebSocketMessage(data: string): {
    valid: boolean;
    message?: WebSocketPayload;
    error?: string;
} {
    try {
        const parsed = JSON.parse(data) as Partial<WebSocketPayload>;

        if (!parsed.id || typeof parsed.id !== 'string') {
            return { valid: false, error: 'Invalid message: missing or invalid id' };
        }

        if (!parsed.type || typeof parsed.type !== 'string') {
            return { valid: false, error: 'Invalid message: missing or invalid type' };
        }

        const validTypes = ['request', 'response', 'error', 'ping', 'pong', 'stream'];
        if (!validTypes.includes(parsed.type)) {
            return { valid: false, error: `Invalid message type: ${parsed.type}` };
        }

        return { valid: true, message: parsed as WebSocketPayload };
    } catch (error) {
        return {
            valid: false,
            error: `JSON parse error: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
    }
}

/**
 * Pure function to check if message is request type
 */
export function isRequestMessage(message: WebSocketPayload): message is WebSocketRequestPayload {
    return message.type === 'request';
}

/**
 * Pure function to check if message is response type
 */
export function isResponseMessage(message: WebSocketPayload): message is WebSocketResponsePayload {
    return message.type === 'response';
}

/**
 * Pure function to check if message is error type
 */
export function isErrorMessage(message: WebSocketPayload): message is WebSocketErrorPayload {
    return message.type === 'error';
}

/**
 * Pure function to check if message is ping type
 */
export function isPingMessage(message: WebSocketPayload): message is WebSocketPingPayload {
    return message.type === 'ping';
}

/**
 * Pure function to check if message is pong type
 */
export function isPongMessage(message: WebSocketPayload): message is WebSocketPongPayload {
    return message.type === 'pong';
}

/**
 * Pure function to check if message is stream type
 */
export function isStreamMessage(message: WebSocketPayload): message is WebSocketStreamPayload {
    return message.type === 'stream';
}

/**
 * Pure function to serialize message for sending
 */
export function serializeMessage(message: WebSocketPayload): string {
    return JSON.stringify(message);
}

/**
 * Pure function to generate unique message ID
 */
export function generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2)}`;
} 