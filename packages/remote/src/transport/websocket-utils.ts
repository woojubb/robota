/**
 * WebSocket Utilities - Pure Functions for Message Handling
 * 
 * Zero any/unknown types, explicit interfaces for all data structures
 */

import type { IChatResponseData, ITransportRequest } from '../shared/types';

export interface IWebSocketRequestPayload {
    id: string;
    type: 'request';
    data: ITransportRequest;
}

export interface IWebSocketResponsePayload {
    id: string;
    type: 'response';
    data: IChatResponseData;
}

export interface IWebSocketErrorPayload {
    id: string;
    type: 'error';
    error: string;
    requestId?: string;
}

export interface IWebSocketPingPayload {
    id: string;
    type: 'ping';
}

export interface IWebSocketPongPayload {
    id: string;
    type: 'pong';
}

export interface IWebSocketStreamPayload {
    id: string;
    type: 'stream';
    data: IChatResponseData;
    requestId: string;
}

export type TWebSocketPayload =
    | IWebSocketRequestPayload
    | IWebSocketResponsePayload
    | IWebSocketErrorPayload
    | IWebSocketPingPayload
    | IWebSocketPongPayload
    | IWebSocketStreamPayload;

/**
 * Pure function to create request message
 */
export function createRequestMessage(id: string, request: ITransportRequest): IWebSocketRequestPayload {
    return {
        id,
        type: 'request',
        data: request
    };
}

/**
 * Pure function to create ping message
 */
export function createPingMessage(id: string): IWebSocketPingPayload {
    return {
        id,
        type: 'ping'
    };
}

/**
 * Pure function to create pong message
 */
export function createPongMessage(id: string): IWebSocketPongPayload {
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
    message?: TWebSocketPayload;
    error?: string;
} {
    try {
        const parsed = JSON.parse(data) as Partial<TWebSocketPayload>;

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

        // Validate required fields per message type
        if ((parsed.type === 'response' || parsed.type === 'stream' || parsed.type === 'request') && !('data' in parsed)) {
            return { valid: false, error: `Invalid message: missing 'data' field for type '${parsed.type}'` };
        }

        if (parsed.type === 'error' && (!('error' in parsed) || typeof (parsed as Partial<IWebSocketErrorPayload>).error !== 'string')) {
            return { valid: false, error: "Invalid message: missing or invalid 'error' field for type 'error'" };
        }

        return { valid: true, message: parsed as TWebSocketPayload };
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
export function isRequestMessage(message: TWebSocketPayload): message is IWebSocketRequestPayload {
    return message.type === 'request';
}

/**
 * Pure function to check if message is response type
 */
export function isResponseMessage(message: TWebSocketPayload): message is IWebSocketResponsePayload {
    return message.type === 'response';
}

/**
 * Pure function to check if message is error type
 */
export function isErrorMessage(message: TWebSocketPayload): message is IWebSocketErrorPayload {
    return message.type === 'error';
}

/**
 * Pure function to check if message is ping type
 */
export function isPingMessage(message: TWebSocketPayload): message is IWebSocketPingPayload {
    return message.type === 'ping';
}

/**
 * Pure function to check if message is pong type
 */
export function isPongMessage(message: TWebSocketPayload): message is IWebSocketPongPayload {
    return message.type === 'pong';
}

/**
 * Pure function to check if message is stream type
 */
export function isStreamMessage(message: TWebSocketPayload): message is IWebSocketStreamPayload {
    return message.type === 'stream';
}

/**
 * Pure function to serialize message for sending
 */
export function serializeMessage(message: TWebSocketPayload): string {
    return JSON.stringify(message);
}

/**
 * Pure function to generate unique message ID
 */
export function generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2)}`;
} 