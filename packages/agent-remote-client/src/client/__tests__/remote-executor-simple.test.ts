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
        messages: [{ role: 'user', content: 'Hello AI', timestamp: new Date() }],
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
        messages: [{ role: 'user', content: 'test', timestamp: new Date() }],
        provider: '',
        model: 'gpt-4',
      } as IChatExecutionRequest;

      await expect(executor.executeChat(invalidRequest)).rejects.toThrow('Provider is required');
    });

    it('should validate model field', async () => {
      const invalidRequest = {
        messages: [{ role: 'user', content: 'test', timestamp: new Date() }],
        provider: 'openai',
        model: '',
      } as IChatExecutionRequest;

      await expect(executor.executeChat(invalidRequest)).rejects.toThrow('Model is required');
    });

    it('should validate individual messages', async () => {
      const invalidRequest = {
        messages: [
          { role: 'user', content: 'valid', timestamp: new Date() },
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
    let validRequest: IStreamExecutionRequest;

    beforeEach(() => {
      executor = new SimpleRemoteExecutor(mockConfig);

      validRequest = {
        messages: [
          {
            id: 'test-user-msg-id',
            role: 'user',
            content: 'Hello',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'openai',
        model: 'gpt-4',
        stream: true,
      };
    });

    it('should handle streaming responses', async () => {
      const sourceResponse: TUniversalMessage = {
        id: 'test-assistant-msg-id',
        role: 'assistant',
        content: 'Streaming response',
        state: 'complete' as const,
        timestamp: new Date(),
      };

      mockHttpClient.chatStream.mockReturnValue(
        (async function* (): AsyncIterable<TUniversalMessage> {
          yield sourceResponse;
        })(),
      );

      const stream = executor.executeChatStream(validRequest);
      const chunks = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        role: 'assistant',
        content: 'Streaming response',
        state: 'complete',
      });
    });

    it('should validate request before streaming', async () => {
      const invalidRequest = {
        messages: [],
        provider: 'openai',
        model: 'gpt-4',
        stream: true,
      } as IStreamExecutionRequest;

      const stream = executor.executeChatStream(invalidRequest);

      await expect(async () => {
        for await (const _chunk of stream) {
          // This should throw before yielding any chunks
        }
      }).rejects.toThrow('Messages array is required and cannot be empty');
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
        { role: 'user', content: 'What is TypeScript?', timestamp: new Date() },
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
