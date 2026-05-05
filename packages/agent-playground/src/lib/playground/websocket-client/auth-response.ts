import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { IPlaygroundWebSocketMessage } from '../types';
import { isUniversalObjectValue } from './message-guards';
import type { IPlaygroundWebSocketAuthenticatedEvent } from './types';

export type TParsedAuthResponse =
  | { kind: 'ignore' }
  | {
      kind: 'success' | 'failure';
      event: IPlaygroundWebSocketAuthenticatedEvent;
      connectionId?: string;
    };

export function parseAuthResponse(message: IPlaygroundWebSocketMessage): TParsedAuthResponse {
  const data = message.data;
  if (!data || !isUniversalObjectValue(data)) {
    return { kind: 'ignore' };
  }

  const success = data.success;
  if (data.message && typeof success !== 'boolean') {
    return { kind: 'ignore' };
  }

  if (success === true) {
    return {
      kind: 'success',
      event: {
        success: true,
        userId: readString(data.userId),
        sessionId: readString(data.sessionId),
      },
      connectionId: readString(data.clientId),
    };
  }

  return {
    kind: 'failure',
    event: {
      success: false,
      error: readString(data.error) ?? 'Authentication failed',
    },
  };
}

function readString(value: TUniversalValue): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
