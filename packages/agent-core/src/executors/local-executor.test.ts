import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalExecutor } from './local-executor';
import type { IAIProviderInstance } from './local-executor';
import type { TUniversalMessage, IAssistantMessage } from '../interfaces/messages';

describe('LocalExecutor', () => {
  let executor: LocalExecutor;
  let mockProvider: IAIProviderInstance;

  beforeEach(() => {
    executor = new LocalExecutor();

    // Create mock provider
    mockProvider = {
      name: 'test-provider',
      async chat(messages: TUniversalMessage[], options?: any): Promise<TUniversalMessage> {
        return {
          id: 'test-id',
          role: 'assistant',
          content: `Mock response to: ${messages[messages.length - 1]?.content}`,
          state: 'complete' as const,
          timestamp: new Date(),
        };
      },
      async *chatStream(
        messages: TUniversalMessage[],
        options?: any,
      ): AsyncIterable<TUniversalMessage> {
        yield {
          id: 'test-id-1',
          role: 'assistant',
          content: 'Mock',
          state: 'complete' as const,
          timestamp: new Date(),
        };
        yield {
          id: 'test-id-2',
          role: 'assistant',
          content: ' streaming',
          state: 'complete' as const,
          timestamp: new Date(),
        };
        yield {
          id: 'test-id-3',
          role: 'assistant',
          content: ' response',
          state: 'complete' as const,
          timestamp: new Date(),
        };
      },
      supportsTools(): boolean {
        return true;
      },
      validateConfig(): boolean {
        return true;
      },
      async dispose(): Promise<void> {
        // Mock dispose
      },
    };
  });

  afterEach(async () => {
    await executor.dispose();
  });

  describe('Provider Registration', () => {
    it('should register and retrieve providers', () => {
      executor.registerProvider('test', mockProvider);

      const retrieved = executor.getProvider('test');
      expect(retrieved).toBe(mockProvider);
    });

    it('should unregister providers', () => {
      executor.registerProvider('test', mockProvider);
      executor.unregisterProvider('test');

      const retrieved = executor.getProvider('test');
      expect(retrieved).toBeUndefined();
    });

    it('should return undefined for non-existent providers', () => {
      const retrieved = executor.getProvider('non-existent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('Chat Execution', () => {
    beforeEach(() => {
      executor.registerProvider('test', mockProvider);
    });

    it('should execute chat requests successfully', async () => {
      const request = {
        messages: [
          {
            id: 'msg-1',
            role: 'user' as const,
            content: 'Hello!',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'test',
        model: 'test-model',
        options: { temperature: 0.7 },
      };

      const response = await executor.executeChat(request);

      expect(response.message.role).toBe('assistant');
      expect(response.message.content).toContain('Mock response to: Hello!');
    });

    it('returns a selected-effort terminal outcome beside, not inside, the assistant message', async () => {
      mockProvider.chat = async (_messages, options) => {
        options?.onModelEffortOutcome?.({
          resolution: {
            selection: 'high',
            effective: 'high',
            disposition: 'exact',
            fingerprint: 'test-model|high|high|exact|test.effort|2026-09-11',
          },
          nativeControl: { state: 'sent', id: 'test.effort' },
          providerDispatch: { state: 'sent' },
        });
        return {
          id: 'outcome-message',
          role: 'assistant',
          content: 'outcome response',
          state: 'complete',
          timestamp: new Date(),
        };
      };
      const result = await executor.executeChat({
        messages: [
          {
            id: 'msg-outcome',
            role: 'user',
            content: 'Hello!',
            state: 'complete',
            timestamp: new Date(),
          },
        ],
        provider: 'test',
        model: 'test-model',
        options: { effort: 'high' },
      });

      expect(result).toEqual({
        message: expect.objectContaining({ content: 'outcome response' }),
        modelEffortOutcome: expect.objectContaining({
          resolution: expect.objectContaining({ selection: 'high' }),
        }),
      });
    });

    it('should throw error for unregistered provider', async () => {
      const request = {
        messages: [
          {
            id: 'msg-1',
            role: 'user' as const,
            content: 'Hello!',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'unregistered',
        model: 'test-model',
      };

      await expect(executor.executeChat(request)).rejects.toThrow(
        'Provider "unregistered" not registered with LocalExecutor',
      );
    });

    it('should execute streaming chat requests', async () => {
      const request = {
        messages: [
          {
            id: 'msg-1',
            role: 'user' as const,
            content: 'Tell me a story',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'test',
        model: 'test-model',
        stream: true as const,
      };

      const chunks: string[] = [];
      for await (const event of executor.executeChatStream(request)) {
        if (event.kind === 'message' && event.message.content) {
          chunks.push(event.message.content);
        }
      }

      expect(chunks).toEqual(['Mock', ' streaming', ' response']);
    });

    it('emits one terminal envelope after local stream messages', async () => {
      mockProvider.chatStream = async function* (_messages, options) {
        yield {
          id: 'stream-outcome-message',
          role: 'assistant' as const,
          content: 'complete',
          state: 'complete' as const,
          timestamp: new Date(),
        };
        options?.onModelEffortOutcome?.({
          resolution: {
            selection: 'high',
            effective: 'high',
            disposition: 'exact',
            fingerprint: 'test-model|high|high|exact|test.effort|2026-09-11',
          },
          nativeControl: { state: 'sent', id: 'test.effort' },
          providerDispatch: { state: 'sent' },
        });
      };
      const events: unknown[] = [];
      for await (const event of executor.executeChatStream({
        messages: [
          {
            id: 'stream-outcome-input',
            role: 'user',
            content: 'Hello!',
            state: 'complete',
            timestamp: new Date(),
          },
        ],
        provider: 'test',
        model: 'test-model',
        stream: true,
        options: { effort: 'high' },
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        { kind: 'message', message: expect.objectContaining({ content: 'complete' }) },
        {
          kind: 'terminal',
          modelEffortOutcome: expect.objectContaining({
            resolution: expect.objectContaining({ selection: 'high' }),
          }),
        },
      ]);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate configuration successfully with valid config', () => {
      const validExecutor = new LocalExecutor({
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
        enableLogging: false,
      });

      expect(validExecutor.validateConfig()).toBe(true);
    });

    it('should fail validation with invalid timeout', () => {
      const invalidExecutor = new LocalExecutor({
        timeout: -1000,
      });

      expect(invalidExecutor.validateConfig()).toBe(false);
    });

    it('should fail validation with invalid retries', () => {
      const invalidExecutor = new LocalExecutor({
        maxRetries: -5,
      });

      expect(invalidExecutor.validateConfig()).toBe(false);
    });
  });

  describe('Tool Support', () => {
    it('should support tools when registered providers support tools', () => {
      executor.registerProvider('test', mockProvider);
      expect(executor.supportsTools()).toBe(true);
    });

    it('should not support tools when no providers are registered', () => {
      expect(executor.supportsTools()).toBe(false);
    });
  });

  describe('Lifecycle Management', () => {
    it('should dispose all registered providers', async () => {
      const disposeSpy = vi.fn();
      const providerWithDispose = {
        ...mockProvider,
        dispose: disposeSpy,
      };

      executor.registerProvider('test', providerWithDispose);
      await executor.dispose();

      expect(disposeSpy).toHaveBeenCalled();
    });

    it('should clear providers after disposal', async () => {
      executor.registerProvider('test', mockProvider);
      await executor.dispose();

      const retrieved = executor.getProvider('test');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle provider without chat method', async () => {
      const providerWithoutChat: IAIProviderInstance = {
        name: 'incomplete-provider',
        supportsTools: () => false,
        validateConfig: () => true,
      };

      executor.registerProvider('incomplete', providerWithoutChat);

      const request = {
        messages: [
          {
            id: 'msg-1',
            role: 'user' as const,
            content: 'Hello!',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'incomplete',
        model: 'test-model',
      };

      await expect(executor.executeChat(request)).rejects.toThrow(
        'Provider "incomplete" does not implement chat method',
      );
    });

    it('should handle provider without chatStream method', async () => {
      const providerWithoutStream: IAIProviderInstance = {
        name: 'no-stream-provider',
        chat: mockProvider.chat!,
        supportsTools: () => false,
        validateConfig: () => true,
      };

      executor.registerProvider('no-stream', providerWithoutStream);

      const request = {
        messages: [
          {
            id: 'msg-1',
            role: 'user' as const,
            content: 'Hello!',
            state: 'complete' as const,
            timestamp: new Date(),
          },
        ],
        provider: 'no-stream',
        model: 'test-model',
        stream: true as const,
      };

      const streamGenerator = executor.executeChatStream(request);
      await expect(async () => {
        const iterator = streamGenerator[Symbol.asyncIterator]();
        await iterator.next();
      }).rejects.toThrow('Provider "no-stream" does not implement chatStream method');
    });
  });
});
