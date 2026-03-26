import type { TUniversalValue } from '@robota-sdk/agent-core';

/**
 * Playground WebSocket message types.
 *
 * Ownership: @robota-sdk/agent-remote-client (transport/types).
 * Consumers: apps/agent-server (server), @robota-sdk/agent-playground (client).
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
