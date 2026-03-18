/**
 * WebSocket Utilities Tests
 *
 * Tests pure functions for WebSocket message handling.
 */

import { describe, it, expect } from 'vitest';
import {
  createRequestMessage,
  createPingMessage,
  createPongMessage,
  validateWebSocketMessage,
  isRequestMessage,
  isResponseMessage,
  isErrorMessage,
  isPingMessage,
  isPongMessage,
  isStreamMessage,
  serializeMessage,
  generateMessageId,
} from '../websocket-utils';
import type {
  TWebSocketPayload,
  IWebSocketRequestPayload,
  IWebSocketResponsePayload,
  IWebSocketErrorPayload,
  IWebSocketPingPayload,
  IWebSocketPongPayload,
  IWebSocketStreamPayload,
} from '../websocket-utils';
import type { ITransportRequest } from '../../shared/types';

describe('WebSocket Utilities', () => {
  describe('createRequestMessage', () => {
    it('should create a request message with id and data', () => {
      const request: ITransportRequest = {
        id: 'req-1',
        url: '/chat',
        endpoint: '/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      };

      const message = createRequestMessage('msg-1', request);

      expect(message.id).toBe('msg-1');
      expect(message.type).toBe('request');
      expect(message.data).toBe(request);
    });
  });

  describe('createPingMessage', () => {
    it('should create a ping message', () => {
      const message = createPingMessage('ping-1');

      expect(message.id).toBe('ping-1');
      expect(message.type).toBe('ping');
    });
  });

  describe('createPongMessage', () => {
    it('should create a pong message', () => {
      const message = createPongMessage('pong-1');

      expect(message.id).toBe('pong-1');
      expect(message.type).toBe('pong');
    });
  });

  describe('validateWebSocketMessage', () => {
    it('should validate a valid response message', () => {
      const data = JSON.stringify({
        id: 'msg-1',
        type: 'response',
        data: { content: 'hello' },
      });

      const result = validateWebSocketMessage(data);

      expect(result.valid).toBe(true);
      expect(result.message).toBeDefined();
      expect(result.message?.type).toBe('response');
    });

    it('should validate a valid request message', () => {
      const data = JSON.stringify({
        id: 'msg-1',
        type: 'request',
        data: { url: '/chat', method: 'POST' },
      });

      const result = validateWebSocketMessage(data);
      expect(result.valid).toBe(true);
    });

    it('should validate a valid error message', () => {
      const data = JSON.stringify({
        id: 'msg-1',
        type: 'error',
        error: 'something went wrong',
      });

      const result = validateWebSocketMessage(data);
      expect(result.valid).toBe(true);
    });

    it('should validate ping message', () => {
      const data = JSON.stringify({ id: 'p-1', type: 'ping' });
      const result = validateWebSocketMessage(data);
      expect(result.valid).toBe(true);
    });

    it('should validate pong message', () => {
      const data = JSON.stringify({ id: 'p-1', type: 'pong' });
      const result = validateWebSocketMessage(data);
      expect(result.valid).toBe(true);
    });

    it('should validate stream message', () => {
      const data = JSON.stringify({
        id: 's-1',
        type: 'stream',
        data: { content: 'chunk' },
        requestId: 'req-1',
      });
      const result = validateWebSocketMessage(data);
      expect(result.valid).toBe(true);
    });

    it('should reject message with missing id', () => {
      const data = JSON.stringify({ type: 'response', data: {} });
      const result = validateWebSocketMessage(data);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('missing or invalid id');
    });

    it('should reject message with non-string id', () => {
      const data = JSON.stringify({ id: 123, type: 'response', data: {} });
      const result = validateWebSocketMessage(data);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('missing or invalid id');
    });

    it('should reject message with missing type', () => {
      const data = JSON.stringify({ id: 'msg-1', data: {} });
      const result = validateWebSocketMessage(data);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('missing or invalid type');
    });

    it('should reject message with invalid type', () => {
      const data = JSON.stringify({ id: 'msg-1', type: 'invalid' });
      const result = validateWebSocketMessage(data);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid message type: invalid');
    });

    it('should reject response message without data field', () => {
      const data = JSON.stringify({ id: 'msg-1', type: 'response' });
      const result = validateWebSocketMessage(data);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("missing 'data' field");
    });

    it('should reject stream message without data field', () => {
      const data = JSON.stringify({ id: 'msg-1', type: 'stream' });
      const result = validateWebSocketMessage(data);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("missing 'data' field");
    });

    it('should reject request message without data field', () => {
      const data = JSON.stringify({ id: 'msg-1', type: 'request' });
      const result = validateWebSocketMessage(data);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("missing 'data' field");
    });

    it('should reject error message without error field', () => {
      const data = JSON.stringify({ id: 'msg-1', type: 'error' });
      const result = validateWebSocketMessage(data);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("missing or invalid 'error' field");
    });

    it('should reject error message with non-string error field', () => {
      const data = JSON.stringify({ id: 'msg-1', type: 'error', error: 123 });
      const result = validateWebSocketMessage(data);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("missing or invalid 'error' field");
    });

    it('should reject invalid JSON', () => {
      const result = validateWebSocketMessage('not json');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('JSON parse error');
    });
  });

  describe('Type guard functions', () => {
    const requestMsg: IWebSocketRequestPayload = {
      id: '1',
      type: 'request',
      data: { id: 'r1', url: '/chat', endpoint: '/chat', method: 'POST', headers: {} },
    };
    const responseMsg: IWebSocketResponsePayload = {
      id: '2',
      type: 'response',
      data: { content: 'hello' },
    };
    const errorMsg: IWebSocketErrorPayload = {
      id: '3',
      type: 'error',
      error: 'fail',
    };
    const pingMsg: IWebSocketPingPayload = { id: '4', type: 'ping' };
    const pongMsg: IWebSocketPongPayload = { id: '5', type: 'pong' };
    const streamMsg: IWebSocketStreamPayload = {
      id: '6',
      type: 'stream',
      data: { content: 'chunk' },
      requestId: 'r1',
    };

    it('isRequestMessage identifies request type', () => {
      expect(isRequestMessage(requestMsg)).toBe(true);
      expect(isRequestMessage(responseMsg)).toBe(false);
    });

    it('isResponseMessage identifies response type', () => {
      expect(isResponseMessage(responseMsg)).toBe(true);
      expect(isResponseMessage(requestMsg)).toBe(false);
    });

    it('isErrorMessage identifies error type', () => {
      expect(isErrorMessage(errorMsg)).toBe(true);
      expect(isErrorMessage(pingMsg)).toBe(false);
    });

    it('isPingMessage identifies ping type', () => {
      expect(isPingMessage(pingMsg)).toBe(true);
      expect(isPingMessage(pongMsg)).toBe(false);
    });

    it('isPongMessage identifies pong type', () => {
      expect(isPongMessage(pongMsg)).toBe(true);
      expect(isPongMessage(pingMsg)).toBe(false);
    });

    it('isStreamMessage identifies stream type', () => {
      expect(isStreamMessage(streamMsg)).toBe(true);
      expect(isStreamMessage(responseMsg)).toBe(false);
    });
  });

  describe('serializeMessage', () => {
    it('should serialize a message to JSON string', () => {
      const message: TWebSocketPayload = { id: '1', type: 'ping' };
      const result = serializeMessage(message);

      expect(result).toBe('{"id":"1","type":"ping"}');
    });

    it('should serialize complex messages', () => {
      const message: TWebSocketPayload = {
        id: '1',
        type: 'response',
        data: { content: 'hello world' },
      };
      const parsed = JSON.parse(serializeMessage(message));

      expect(parsed.id).toBe('1');
      expect(parsed.type).toBe('response');
      expect(parsed.data.content).toBe('hello world');
    });
  });

  describe('generateMessageId', () => {
    it('should generate a string starting with msg_', () => {
      const id = generateMessageId();
      expect(id).toMatch(/^msg_\d+_/);
    });

    it('should generate unique ids', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateMessageId()));
      // Statistically all should be unique
      expect(ids.size).toBeGreaterThanOrEqual(95);
    });
  });
});
