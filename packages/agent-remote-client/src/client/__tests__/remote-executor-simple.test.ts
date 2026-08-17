/**
 * SimpleRemoteExecutor Facade Tests
 *
 * Testing the main facade pattern implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimpleRemoteExecutor } from '../remote-executor-simple';
import type { ISimpleRemoteConfig } from '../remote-executor-simple';
import type {
  IChatExecutionRequest,
  IStreamExecutionRequest,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

// Mock the HttpClient
const mockHttpClient = {
  post: vi.fn(),
  get: vi.fn(),
  chat: vi.fn(),
  chatStream: vi.fn(),
  validateConfig: vi.fn().mockReturnValue(true),
};

vi.mock('../http-client', () => ({
  HttpClient: vi.fn().mockImplementation(() => mockHttpClient),
}));

describe('SimpleRemoteExecutor Facade', () => {
  let executor: SimpleRemoteExecutor;
  let mockConfig: ISimpleRemoteConfig;

  beforeEach(() => {
    mockConfig = {
      serverUrl: 'https://api.test.com',
      userApiKey: 'test-api-key',
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Configuration', () => {
    it('should initialize with valid config', () => {
      expect(() => {
        executor = new SimpleRemoteExecutor(mockConfig);
      }).not.toThrow();

      expect(executor.name).toBe('remote');
      expect(executor.version).toBe('1.0.0');
    });

    it('should throw on invalid config - missing serverUrl', () => {
      const invalidConfig = {
        userApiKey: 'test-key',
      } as ISimpleRemoteConfig;

      expect(() => {
        new SimpleRemoteExecutor(invalidConfig);
      }).toThrow('BaseURL is required but not provided');
    });

    it('should throw on invalid config - empty serverUrl', () => {
      const invalidConfig: ISimpleRemoteConfig = {
        serverUrl: '',
        userApiKey: 'test-key',
      };

      expect(() => {
        new SimpleRemoteExecutor(invalidConfig);
      }).toThrow('BaseURL is required but not provided');
    });

    it('should throw on invalid config - missing userApiKey', () => {
      const invalidConfig = {
        serverUrl: 'https://api.test.com',
      } as ISimpleRemoteConfig;

      expect(() => {
        new SimpleRemoteExecutor(invalidConfig);
      }).toThrow('User API key is required but not provided');
    });

    it('should accept optional configuration parameters', () => {
      const configWithOptionals: ISimpleRemoteConfig = {
        serverUrl: 'https://api.test.com',
        userApiKey: 'test-key',
        timeout: 60000,
        headers: { 'X-Custom': 'value' },
      };

      expect(() => {
        executor = new SimpleRemoteExecutor(configWithOptionals);
      }).not.toThrow();
    });
  });

  describe('validateConfig', () => {
    beforeEach(() => {
      executor = new SimpleRemoteExecutor(mockConfig);
    });

    it('should validate current config when no parameter provided', () => {
      expect(executor.validateConfig()).toBe(true);
    });

    it('should validate a different instance with another valid config', () => {
      const validConfig: ISimpleRemoteConfig = {
        serverUrl: 'https://other.api.com',
        userApiKey: 'other-key',
      };
      const other = new SimpleRemoteExecutor(validConfig);
      expect(other.validateConfig()).toBe(true);
    });
  });

  describe('Chat Execution', () => {
    let validRequest: IChatExecutionRequest;

    beforeEach(() => {
      executor = new SimpleRemoteExecutor(mockConfig);

      validRequest = {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello AI',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'openai',
        model: 'gpt-4',
      };
    });

    it('should execute chat requests successfully', async () => {
      const expectedResponse = {
        role: 'assistant',
        content: 'Hello back!',
        timestamp: new Date(),
        provider: 'openai',
        model: 'gpt-4',
      };

      mockHttpClient.chat.mockResolvedValue(expectedResponse);

      const result = await executor.executeChat(validRequest);

      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Hello back!');
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(mockHttpClient.chat).toHaveBeenCalled();
    });

    it('should validate request before execution', async () => {
      const invalidRequest = {
        messages: [],
        provider: 'openai',
        model: 'gpt-4',
      } as IChatExecutionRequest;

      await expect(executor.executeChat(invalidRequest)).rejects.toThrow(
        'Messages array is required and cannot be empty',
      );
    });

    it('should validate provider field', async () => {
      const invalidRequest = {
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

      await expect(executor.executeChat(invalidRequest)).rejects.toThrow('Provider is required');
    });

    it('should validate model field', async () => {
      const invalidRequest = {
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

      await expect(executor.executeChat(invalidRequest)).rejects.toThrow('Model is required');
    });

    it('should validate individual messages', async () => {
      const invalidRequest = {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'test',
            state: 'complete' as const,
            timestamp: new Date(),
          },
          { role: 123, content: 'invalid role' } as any,
        ],
        provider: 'openai',
        model: 'gpt-4',
      } as IChatExecutionRequest;

      await expect(executor.executeChat(invalidRequest)).rejects.toThrow(
        'Invalid message at index 1: role and content must be strings',
      );
    });

    it('should handle HTTP client errors', async () => {
      const httpError = new Error('Network error');
      mockHttpClient.chat.mockRejectedValue(httpError);

      await expect(executor.executeChat(validRequest)).rejects.toThrow('Network error');
    });
  });

  describe('Stream Execution', () => {
    const streamRequest = {
      messages: [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello AI',
          state: 'complete' as const,
          timestamp: new Date(),
        },
      ],
      provider: 'openai',
      model: 'gpt-4',
      tools: undefined,
      stream: true as const,
    };

    beforeEach(() => {
      executor = new SimpleRemoteExecutor(mockConfig);
    });

    // CORE-046 inverts what CORE-044 pinned here. The old cases drove `executeChatStream` against a
    // mocked HttpClient, so they were green while every real call 404'd — the client posted to
    // `${baseUrl}/stream`, a sibling named `/chat/stream`, and the server served neither. A mocked
    // transport cannot notice that the far end does not exist, which is why the ROUTE is asserted
    // against the server's real table in `chat-stream-route-contract.test.ts`, and only the
    // executor's own behaviour is asserted here.
    it('advertises streaming again, now that a server serves the route', () => {
      expect(typeof (executor as unknown as Record<string, unknown>)['executeChatStream']).toBe(
        'function',
      );
    });

    it('hands every delta to the caller and yields ONE assembled message', async () => {
      const deltas: string[] = [];
      mockHttpClient.chatStream = vi
        .fn()
        .mockImplementation(async (_m, _p, _model, onDelta: (d: string) => void) => {
          for (const piece of ['a', 'b', 'c']) onDelta(piece);
          return {
            content: 'abc',
            toolCalls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{}' } }],
          };
        });

      const yielded = [];
      for await (const message of executor.executeChatStream!({
        ...streamRequest,
        options: { model: 'gpt-4', onTextDelta: (d: string) => deltas.push(d) },
      } as never)) {
        yielded.push(message);
      }

      expect(deltas).toEqual(['a', 'b', 'c']);
      // ONE message, not one per delta: `IExecutor.executeChatStream` yields `TUniversalMessage`,
      // and a partial message is not one. The live text is what `onTextDelta` carries.
      expect(yielded).toHaveLength(1);
      expect(yielded[0].content).toBe('abc');
      // Narrowed rather than asserted through the union: only an assistant message carries them,
      // and yielding anything else would be the defect this case is about.
      expect((yielded[0] as { toolCalls?: unknown[] }).toolCalls).toHaveLength(1);
    });

    it('forwards the whole options object, as the non-streaming path does (CORE-044)', async () => {
      mockHttpClient.chatStream = vi.fn().mockResolvedValue({ content: 'ok' });

      const options = { model: 'gpt-4', temperature: 0.2, toolChoice: 'auto' as const };
      for await (const _message of executor.executeChatStream!({
        ...streamRequest,
        options,
      } as never)) {
        // drain
      }

      expect(mockHttpClient.chatStream).toHaveBeenCalledWith(
        expect.anything(),
        streamRequest.provider,
        streamRequest.model,
        expect.any(Function),
        streamRequest.tools,
        options,
      );
    });
  });

  describe('Utility Methods', () => {
    beforeEach(() => {
      executor = new SimpleRemoteExecutor(mockConfig);
    });

    it('should support tools', () => {
      expect(executor.supportsTools()).toBe(true);
    });

    it('should dispose cleanly', async () => {
      await expect(executor.dispose()).resolves.toBeUndefined();
    });
  });

  describe('Integration Scenarios', () => {
    beforeEach(() => {
      // Mock is already set up globally
    });

    it('should handle complete conversation flow', async () => {
      executor = new SimpleRemoteExecutor(mockConfig);

      const messages: TUniversalMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'What is TypeScript?',
          state: 'complete' as const,
          timestamp: new Date(),
        },
      ];

      const mockResponse = {
        role: 'assistant',
        content: 'TypeScript is a typed superset of JavaScript.',
        timestamp: new Date(),
        provider: 'openai',
        model: 'gpt-4',
      };

      mockHttpClient.chat.mockResolvedValue(mockResponse);

      const request: IChatExecutionRequest = {
        messages,
        provider: 'openai',
        model: 'gpt-4',
      };

      const response = await executor.executeChat(request);

      expect(response.role).toBe('assistant');
      expect(response.content).toContain('TypeScript');
      expect(response.timestamp).toBeInstanceOf(Date);
    });

    it('should handle configuration changes', () => {
      executor = new SimpleRemoteExecutor(mockConfig);

      // Should work with initial config
      expect(executor.validateConfig()).toBe(true);

      // Should validate different config
      const newConfig: ISimpleRemoteConfig = {
        serverUrl: 'https://api.example.com',
        userApiKey: 'new-key',
      };

      expect(new SimpleRemoteExecutor(newConfig).validateConfig()).toBe(true);
    });

    it('should maintain facade simplicity', () => {
      executor = new SimpleRemoteExecutor(mockConfig);

      // Facade should expose minimal, clean interface
      const publicMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(executor)).filter(
        (name) => name !== 'constructor' && !name.startsWith('_'),
      );

      // CORE-046 adds `executeChatStream` back to the surface. It was removed by CORE-044 because
      // no server served the route it posted to; one does now, and this enumeration is the record
      // that says so — the same reason the absence was pinned rather than merely deleted.
      expect(publicMethods).toEqual([
        'executeChat',
        'executeChatStream',
        'supportsTools',
        'validateConfig',
        'dispose',
      ]);
    });
  });
});
