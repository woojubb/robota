import type { TUniversalValue } from '@robota-sdk/agents';

/**
 * Playground WebSocket message types.
 *
 * Ownership: @robota-sdk/remote (transport/types).
 * Consumers: apps/api-server (server), @robota-sdk/playground (client).
 */
export type TPlaygroundWebSocketMessageKind = 'playground_update' | 'auth' | 'ping' | 'pong';

export interface IPlaygroundWebSocketMessage {
    [key: string]: TUniversalValue;
    type: TPlaygroundWebSocketMessageKind;
    timestamp: string;
    data?: TUniversalValue;
    userId?: string;
    sessionId?: string;
}


