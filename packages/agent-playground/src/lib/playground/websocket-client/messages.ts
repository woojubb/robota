import type { IPlaygroundWebSocketMessage } from '../types';
import { PLAYGROUND_WS_MESSAGE_TYPES } from './constants';

export function buildPlaygroundWebSocketUrl(serverUrl: string): string {
  return `${serverUrl.replace(/^http/, 'ws')}/ws/playground`;
}

export function createTimestampedMessage(
  message: Omit<IPlaygroundWebSocketMessage, 'timestamp'>,
): IPlaygroundWebSocketMessage {
  return {
    ...message,
    timestamp: new Date().toISOString(),
  } as IPlaygroundWebSocketMessage;
}

export function createAuthMessage(
  userId: string,
  sessionId: string,
  authToken: string,
): Omit<IPlaygroundWebSocketMessage, 'timestamp'> {
  return {
    type: PLAYGROUND_WS_MESSAGE_TYPES.AUTH,
    data: {
      userId,
      sessionId,
      token: authToken,
    },
  };
}
