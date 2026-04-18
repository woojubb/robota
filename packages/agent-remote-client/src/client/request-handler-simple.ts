/**
 * Simplified Request Handler - Type Safe Implementation
 *
 * Handles request/response transformation with zero any/unknown types
 */

import { randomUUID } from 'node:crypto';
import type {
  IChatExecutionRequest,
  IStreamExecutionRequest,
  IAssistantMessage,
  ITransportRequest,
  ITransportResponse,
  IChatResponseData,
} from '../shared/types';

const RANDOM_ID_RADIX = 36;

/**
 * Create transport request for chat execution
 */
export function createChatTransportRequest(request: IChatExecutionRequest): ITransportRequest {
  return {
    id: generateRequestId(),
    url: '/chat',
    endpoint: '/chat',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content || '',
      })),
      provider: request.provider,
      model: request.model,
    },
  };
}

/**
 * Create transport request for stream execution
 */
export function createStreamTransportRequest(request: IStreamExecutionRequest): ITransportRequest {
  return {
    id: generateRequestId(),
    url: '/chat/stream',
    endpoint: '/chat/stream',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content || '',
      })),
      provider: request.provider,
      model: request.model,
      stream: true,
    },
  };
}

/**
 * Transform transport response to assistant message
 */
export function transformToAssistantMessage(
  response: ITransportResponse<IChatResponseData>,
): IAssistantMessage {
  return {
    id: randomUUID(),
    role: 'assistant',
    content: response.data.content,
    state: 'complete',
    timestamp: new Date(),
  };
}

/**
 * Validate chat execution request
 */
export function validateChatRequest(request: IChatExecutionRequest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!request.messages || request.messages.length === 0) {
    errors.push('messages array is required and cannot be empty');
  }

  if (!request.provider) {
    errors.push('provider is required');
  }

  if (!request.model) {
    errors.push('model is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate stream execution request
 */
export function validateStreamRequest(request: IStreamExecutionRequest): {
  valid: boolean;
  errors: string[];
} {
  return validateChatRequest(request);
}

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(RANDOM_ID_RADIX).substring(2)}`;
}
