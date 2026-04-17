/**
 * Request Handler Simple Tests
 *
 * Tests the pure request/response transformation functions.
 */

import { describe, it, expect } from 'vitest';
import {
  createChatTransportRequest,
  createStreamTransportRequest,
  transformToAssistantMessage,
  validateChatRequest,
  validateStreamRequest,
} from '../request-handler-simple';
import type { IChatExecutionRequest, IStreamExecutionRequest } from '../../shared/types';
import type { ITransportResponse, IChatResponseData } from '../../shared/types';

describe('Request Handler Simple', () => {
  describe('createChatTransportRequest', () => {
    it('should create a transport request from chat execution request', () => {
      const request: IChatExecutionRequest = {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'openai',
        model: 'gpt-4',
      };

      const result = createChatTransportRequest(request);

      expect(result.url).toBe('/chat');
      expect(result.endpoint).toBe('/chat');
      expect(result.method).toBe('POST');
      expect(result.headers['Content-Type']).toBe('application/json');
      expect(result.id).toMatch(/^req_/);
      expect(result.data).toEqual({
        messages: [{ role: 'user', content: 'Hello' }],
        provider: 'openai',
        model: 'gpt-4',
      });
    });

    it('should handle messages with null content', () => {
      const request: IChatExecutionRequest = {
        messages: [
          {
            id: 'msg-2',
            role: 'assistant',
            content: null as unknown as string,
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'openai',
        model: 'gpt-4',
      };

      const result = createChatTransportRequest(request);

      expect(result.data?.messages[0].content).toBe('');
    });

    it('should map multiple messages', () => {
      const request: IChatExecutionRequest = {
        messages: [
          {
            id: 'msg-3',
            role: 'system',
            content: 'You are helpful',
            state: 'complete' as const,
            timestamp: new Date(),
          },
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hi',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'anthropic',
        model: 'claude-3',
      };

      const result = createChatTransportRequest(request);

      expect(result.data?.messages).toHaveLength(2);
      expect(result.data?.provider).toBe('anthropic');
      expect(result.data?.model).toBe('claude-3');
    });
  });

  describe('createStreamTransportRequest', () => {
    it('should create a stream transport request', () => {
      const request: IStreamExecutionRequest = {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Stream this',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'openai',
        model: 'gpt-4',
        stream: true,
      };

      const result = createStreamTransportRequest(request);

      expect(result.url).toBe('/chat/stream');
      expect(result.endpoint).toBe('/chat/stream');
      expect(result.method).toBe('POST');
      expect(result.data?.stream).toBe(true);
    });
  });

  describe('transformToAssistantMessage', () => {
    it('should transform transport response to assistant message', () => {
      const response: ITransportResponse<IChatResponseData> = {
        id: 'resp-1',
        status: 200,
        headers: {},
        data: { content: 'Hello from AI' },
        timestamp: new Date(),
      };

      const result = transformToAssistantMessage(response);

      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Hello from AI');
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('validateChatRequest', () => {
    it('should validate a valid request', () => {
      const request: IChatExecutionRequest = {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'test',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'openai',
        model: 'gpt-4',
      };

      const result = validateChatRequest(request);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty messages', () => {
      const request: IChatExecutionRequest = {
        messages: [],
        provider: 'openai',
        model: 'gpt-4',
      };

      const result = validateChatRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('messages array is required and cannot be empty');
    });

    it('should reject missing provider', () => {
      const request = {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'test',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: '',
        model: 'gpt-4',
      } as IChatExecutionRequest;

      const result = validateChatRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('provider is required');
    });

    it('should reject missing model', () => {
      const request = {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'test',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'openai',
        model: '',
      } as IChatExecutionRequest;

      const result = validateChatRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('model is required');
    });

    it('should collect multiple errors', () => {
      const request = {
        messages: [],
        provider: '',
        model: '',
      } as IChatExecutionRequest;

      const result = validateChatRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
    });
  });

  describe('validateStreamRequest', () => {
    it('should delegate to validateChatRequest', () => {
      const request: IStreamExecutionRequest = {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'test',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'openai',
        model: 'gpt-4',
        stream: true,
      };

      const result = validateStreamRequest(request);

      expect(result.valid).toBe(true);
    });

    it('should reject invalid stream request', () => {
      const request = {
        messages: [],
        provider: '',
        model: '',
        stream: true,
      } as IStreamExecutionRequest;

      const result = validateStreamRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
