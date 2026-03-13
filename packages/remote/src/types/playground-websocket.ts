import type { TUniversalValue } from '@robota-sdk/agents';

/**
 * Playground WebSocket message types.
 *
 * Ownership: @robota-sdk/remote (transport/types).
 * Consumers: apps/agent-server (server), @robota-sdk/playground (client).
 */
/** Discriminant values for playground WebSocket message types. */
export type TPlaygroundWebSocketMessageKind = 'playground_update' | 'auth' | 'ping' | 'pong';

/** Structure of a WebSocket message exchanged between the playground client and API server. */
export interface IPlaygroundWebSocketMessage {
    [key: string]: TUniversalValue;
    type: TPlaygroundWebSocketMessageKind;
    timestamp: string;
    data?: TUniversalValue;
    userId?: string;
    sessionId?: string;
}


