import type { IPlaygroundWebSocketMessage } from '../types';

export interface IPlaygroundConnectionStatus {
  connected: boolean;
  authenticated: boolean;
  connectionId?: string;
  lastActivity?: Date;
  error?: string;
}

export interface IPlaygroundWebSocketAuthenticatedEvent {
  success: boolean;
  userId?: string;
  sessionId?: string;
  error?: string;
}

export interface IPlaygroundWebSocketConnectionEvent {
  connected: boolean;
}

export interface IPlaygroundWebSocketErrorEvent {
  error: string;
}

export type TPlaygroundWebSocketEventPayload =
  | IPlaygroundWebSocketMessage
  | IPlaygroundWebSocketAuthenticatedEvent
  | IPlaygroundWebSocketConnectionEvent
  | IPlaygroundWebSocketErrorEvent;

export type TPlaygroundWebSocketEventHandler = (payload: TPlaygroundWebSocketEventPayload) => void;
