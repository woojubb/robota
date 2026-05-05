import type { TUniversalValue } from '@robota-sdk/agent-core';
import { WebLogger } from '../../web-logger';
import type { IPlaygroundWebSocketMessage } from '../types';
import { PLAYGROUND_WS_MESSAGE_TYPES } from './constants';

export function isUniversalObjectValue(
  value: TUniversalValue,
): value is Record<string, TUniversalValue> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

export function isPlaygroundWebSocketMessage(
  value: TUniversalValue,
): value is IPlaygroundWebSocketMessage {
  if (!isUniversalObjectValue(value)) return false;
  const type = value.type;
  const timestamp = value.timestamp;
  if (typeof type !== 'string' || typeof timestamp !== 'string') return false;
  return (
    type === PLAYGROUND_WS_MESSAGE_TYPES.PLAYGROUND_UPDATE ||
    type === PLAYGROUND_WS_MESSAGE_TYPES.AUTH ||
    type === PLAYGROUND_WS_MESSAGE_TYPES.PING ||
    type === PLAYGROUND_WS_MESSAGE_TYPES.PONG
  );
}

export function parsePlaygroundWebSocketMessage(
  data: string,
): IPlaygroundWebSocketMessage | undefined {
  try {
    const parsed = JSON.parse(data) as TUniversalValue;
    if (!isPlaygroundWebSocketMessage(parsed)) {
      WebLogger.error('Invalid WebSocket message', {
        error: 'Message shape validation failed',
      });
      return undefined;
    }
    return parsed;
  } catch (error) {
    WebLogger.error('Invalid WebSocket message', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
