import { describe, it, expect } from 'vitest';
import {
  computeRoundThinkingContext,
  validateAndExtractResponse,
  callProviderWithCache,
  addToolResultsToHistory,
} from './execution-round';
import type { ILogger } from '../utils/logger';
import { vi } from 'vitest';

function mockLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
}

function createResolvedProviderInfo(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    provider: { chat: vi.fn() },
    currentInfo: { provider: 'openai' },
    aiProviderInfo: {
      providerName: 'openai',
      model: 'gpt-4',
      temperature: undefined,
      maxTokens: undefined,
    },
    toolsInfo: [],
    availableTools: [],
    ...overrides,
  };
}

describe('execution-round helpers', () => {
  describe('computeRoundThinkingContext', () => {
    it('generates thinkingNodeId based on conversationId and count', () => {
      const result = computeRoundThinkingContext('conv-1', {
        currentRound: 1,
        runningAssistantCount: 0,
        toolsExecuted: [],
        lastTrackedAssistantMessage: undefined,
      });
      expect(result.thinkingNodeId).toBe('thinking_conv-1_round1');
      expect(result.previousThinkingNodeId).toBeUndefined();
    });

    it('chains from previous tool result when assistant had tool calls', () => {
      const result = computeRoundThinkingContext('conv-1', {
        currentRound: 2,
        runningAssistantCount: 1,
        toolsExecuted: ['search'],
        lastTrackedAssistantMessage: {
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          toolCalls: [
            { id: 'tc-1', type: 'function', function: { name: 'search', arguments: '{}' } },
          ],
        },
      });
      expect(result.thinkingNodeId).toBe('thinking_conv-1_round2');
      expect(result.previousThinkingNodeId).toBe('thinking_conv-1_round1');
    });
  });

  describe('validateAndExtractResponse', () => {
    const logger = mockLogger();

    it('extracts assistant response with content', () => {
      const response = {
        role: 'assistant' as const,
        content: 'hello',
        timestamp: new Date(),
      };
      const result = validateAndExtractResponse(response, 'exec-1', 'conv-1', 1, logger);
      expect(result.assistantResponse.content).toBe('hello');
      expect(result.assistantToolCalls).toEqual([]);
    });

    it('extracts tool calls from response', () => {
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'fn', arguments: '{}' } },
      ];
      const response = {
        role: 'assistant' as const,
        content: null,
        timestamp: new Date(),
        toolCalls,
      };
      const result = validateAndExtractResponse(response, 'exec-1', 'conv-1', 1, logger);
      expect(result.assistantToolCalls).toHaveLength(1);
    });

    it('throws for non-assistant response', () => {
      const response = {
        role: 'user' as const,
        content: 'hello',
        timestamp: new Date(),
      };
      expect(() => validateAndExtractResponse(response, 'exec-1', 'conv-1', 1, logger)).toThrow(
        'Unexpected response role: user',
      );
    });

    it('throws when response has no content and no tool calls', () => {
      const response = {
        role: 'assistant' as const,
        content: undefined as any,
        timestamp: new Date(),
      };
      expect(() => validateAndExtractResponse(response, 'exec-1', 'conv-1', 1, logger)).toThrow(
        'Provider response must have content or tool calls',
      );
    });
  });

  describe('callProviderWithCache', () => {
    it('throws when model is empty string', async () => {
      const config = { name: 'test', defaultModel: { provider: 'openai', model: '' } };
      const resolved = createResolvedProviderInfo();
      // Empty string is falsy, hits the first guard
      await expect(callProviderWithCache([], config as any, resolved)).rejects.toThrow(
        'Model is required',
      );
    });

    it('throws when model is whitespace only', async () => {
      const config = { name: 'test', defaultModel: { provider: 'openai', model: '  ' } };
      const resolved = createResolvedProviderInfo();
      await expect(callProviderWithCache([], config as any, resolved)).rejects.toThrow(
        'Model must be a non-empty string',
      );
    });

    it('throws when model is missing', async () => {
      const config = { name: 'test', defaultModel: { provider: 'openai' } };
      const resolved = createResolvedProviderInfo();
      await expect(callProviderWithCache([], config as any, resolved)).rejects.toThrow(
        'Model is required',
      );
    });

    it('calls provider without cache', async () => {
      const mockResponse = { role: 'assistant', content: 'hi', timestamp: new Date() };
      const resolved = createResolvedProviderInfo({
        provider: { chat: vi.fn().mockResolvedValue(mockResponse) },
      });
      const config = { name: 'test', defaultModel: { provider: 'openai', model: 'gpt-4' } };
      const result = await callProviderWithCache(
        [{ role: 'user', content: 'hello', timestamp: new Date() }],
        config as any,
        resolved,
      );
      expect(result).toBe(mockResponse);
      expect(resolved.provider.chat).toHaveBeenCalled();
    });

    it('uses cached response when available', async () => {
      const config = { name: 'test', defaultModel: { provider: 'openai', model: 'gpt-4' } };
      const resolved = createResolvedProviderInfo();
      const cacheService = {
        lookup: vi.fn().mockReturnValue('cached response'),
        store: vi.fn(),
      };
      const result = await callProviderWithCache([], config as any, resolved, cacheService as any);
      expect(result.content).toBe('cached response');
      expect(resolved.provider.chat).not.toHaveBeenCalled();
    });

    it('stores response in cache on miss', async () => {
      const mockResponse = { role: 'assistant', content: 'fresh', timestamp: new Date() };
      const config = { name: 'test', defaultModel: { provider: 'openai', model: 'gpt-4' } };
      const resolved = createResolvedProviderInfo({
        provider: { chat: vi.fn().mockResolvedValue(mockResponse) },
      });
      const cacheService = {
        lookup: vi.fn().mockReturnValue(undefined),
        store: vi.fn(),
      };
      await callProviderWithCache([], config as any, resolved, cacheService as any);
      expect(cacheService.store).toHaveBeenCalled();
    });
  });

  describe('addToolResultsToHistory', () => {
    const logger = mockLogger();

    it('adds successful tool results to session', () => {
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'search', arguments: '{}' } },
      ];
      const toolSummary = {
        results: [{ executionId: 'tc-1', toolName: 'search', success: true, result: 'found it' }],
        errors: [],
      };
      const session = { getMessages: () => [], addToolMessageWithId: vi.fn() };

      addToolResultsToHistory(toolCalls, toolSummary, session as any, 1, logger);
      expect(session.addToolMessageWithId).toHaveBeenCalledWith(
        'found it',
        'tc-1',
        'search',
        expect.objectContaining({ success: true }),
      );
    });

    it('adds failed tool results to session', () => {
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'search', arguments: '{}' } },
      ];
      const toolSummary = {
        results: [{ executionId: 'tc-1', toolName: 'search', success: false, error: 'not found' }],
        errors: [],
      };
      const session = { getMessages: () => [], addToolMessageWithId: vi.fn() };

      addToolResultsToHistory(toolCalls, toolSummary, session as any, 1, logger);
      expect(session.addToolMessageWithId).toHaveBeenCalledWith(
        'Error: not found',
        'tc-1',
        'search',
        expect.objectContaining({ success: false }),
      );
    });

    it('throws when tool call has no ID', () => {
      const toolCalls = [
        { type: 'function' as const, function: { name: 'search', arguments: '{}' } },
      ] as any;
      const session = { getMessages: () => [], addToolMessageWithId: vi.fn() };

      expect(() =>
        addToolResultsToHistory(toolCalls, { results: [], errors: [] }, session as any, 1, logger),
      ).toThrow('Tool call missing ID');
    });

    it('throws when no result found for tool call', () => {
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'search', arguments: '{}' } },
      ];
      const session = { getMessages: () => [], addToolMessageWithId: vi.fn() };

      expect(() =>
        addToolResultsToHistory(toolCalls, { results: [], errors: [] }, session as any, 1, logger),
      ).toThrow('No execution result found for tool call ID: tc-1');
    });

    it('works normally without contextBudget (backward compatible)', () => {
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'Read', arguments: '{}' } },
        { id: 'tc-2', type: 'function' as const, function: { name: 'Bash', arguments: '{}' } },
      ];
      const toolSummary = {
        results: [
          { executionId: 'tc-1', toolName: 'Read', success: true, result: 'file content' },
          { executionId: 'tc-2', toolName: 'Bash', success: true, result: 'output' },
        ],
        errors: [],
      };
      const session = { getMessages: () => [], addToolMessageWithId: vi.fn() };

      addToolResultsToHistory(toolCalls, toolSummary, session as any, 1, logger);
      expect(session.addToolMessageWithId).toHaveBeenCalledTimes(2);
    });

    it('skips remaining tool results when context budget is exceeded', () => {
      // Simulate: contextLimit = 1000 tokens, threshold 80% = 800 tokens
      // First tool result pushes history beyond 800 tokens
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'Read', arguments: '{}' } },
        { id: 'tc-2', type: 'function' as const, function: { name: 'Bash', arguments: '{}' } },
        { id: 'tc-3', type: 'function' as const, function: { name: 'Glob', arguments: '{}' } },
      ];
      const largeContent = 'x'.repeat(3000); // ~1000 tokens at chars/3
      const toolSummary = {
        results: [
          { executionId: 'tc-1', toolName: 'Read', success: true, result: largeContent },
          { executionId: 'tc-2', toolName: 'Bash', success: true, result: 'small' },
          { executionId: 'tc-3', toolName: 'Glob', success: true, result: 'small' },
        ],
        errors: [],
      };

      // After tc-1 is added, getMessages returns the large content
      const messages: Array<{ role: string; content: string }> = [];
      const session = {
        getMessages: () => messages,
        addToolMessageWithId: vi.fn((content: string) => {
          messages.push({ role: 'tool', content });
        }),
      };

      const contextBudget = { contextLimit: 1000, cumulativeInputTokens: 0 };

      addToolResultsToHistory(toolCalls, toolSummary, session as any, 1, logger, contextBudget);

      // tc-1 added normally (triggers overflow detection)
      // tc-2 and tc-3 should be skipped with overflow message
      expect(session.addToolMessageWithId).toHaveBeenCalledTimes(3);

      // First call: normal content
      expect(session.addToolMessageWithId.mock.calls[0][0]).toBe(largeContent);

      // Second and third calls: overflow skip message
      expect(session.addToolMessageWithId.mock.calls[1][0]).toContain('Context window near capacity');
      expect(session.addToolMessageWithId.mock.calls[2][0]).toContain('Context window near capacity');
    });

    it('does not skip when context budget has enough room', () => {
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'Read', arguments: '{}' } },
        { id: 'tc-2', type: 'function' as const, function: { name: 'Bash', arguments: '{}' } },
      ];
      const toolSummary = {
        results: [
          { executionId: 'tc-1', toolName: 'Read', success: true, result: 'small' },
          { executionId: 'tc-2', toolName: 'Bash', success: true, result: 'small' },
        ],
        errors: [],
      };

      const messages: Array<{ role: string; content: string }> = [];
      const session = {
        getMessages: () => messages,
        addToolMessageWithId: vi.fn((content: string) => {
          messages.push({ role: 'tool', content });
        }),
      };

      // Large context limit — plenty of room
      const contextBudget = { contextLimit: 1_000_000, cumulativeInputTokens: 0 };

      addToolResultsToHistory(toolCalls, toolSummary, session as any, 1, logger, contextBudget);

      // Both added normally
      expect(session.addToolMessageWithId).toHaveBeenCalledTimes(2);
      expect(session.addToolMessageWithId.mock.calls[0][0]).toBe('small');
      expect(session.addToolMessageWithId.mock.calls[1][0]).toBe('small');
    });

    it('uses cumulativeInputTokens when higher than chars estimate', () => {
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'Read', arguments: '{}' } },
        { id: 'tc-2', type: 'function' as const, function: { name: 'Bash', arguments: '{}' } },
      ];
      const toolSummary = {
        results: [
          { executionId: 'tc-1', toolName: 'Read', success: true, result: 'tiny' },
          { executionId: 'tc-2', toolName: 'Bash', success: true, result: 'tiny' },
        ],
        errors: [],
      };

      const messages: Array<{ role: string; content: string }> = [];
      const session = {
        getMessages: () => messages,
        addToolMessageWithId: vi.fn((content: string) => {
          messages.push({ role: 'tool', content });
        }),
      };

      // Small history chars, but API reports high token count already
      // contextLimit=1000, cumulativeInputTokens=900 → 900 > 1000*0.8=800 → overflow
      const contextBudget = { contextLimit: 1000, cumulativeInputTokens: 900 };

      addToolResultsToHistory(toolCalls, toolSummary, session as any, 1, logger, contextBudget);

      // tc-1 added normally, then overflow triggers → tc-2 skipped
      expect(session.addToolMessageWithId).toHaveBeenCalledTimes(2);
      expect(session.addToolMessageWithId.mock.calls[0][0]).toBe('tiny');
      expect(session.addToolMessageWithId.mock.calls[1][0]).toContain('Context window near capacity');
    });

    it('skipped tool results have context_overflow error metadata', () => {
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'Read', arguments: '{}' } },
        { id: 'tc-2', type: 'function' as const, function: { name: 'Bash', arguments: '{}' } },
      ];
      const largeContent = 'x'.repeat(3000);
      const toolSummary = {
        results: [
          { executionId: 'tc-1', toolName: 'Read', success: true, result: largeContent },
          { executionId: 'tc-2', toolName: 'Bash', success: true, result: 'small' },
        ],
        errors: [],
      };

      const messages: Array<{ role: string; content: string }> = [];
      const session = {
        getMessages: () => messages,
        addToolMessageWithId: vi.fn((content: string) => {
          messages.push({ role: 'tool', content });
        }),
      };

      addToolResultsToHistory(
        toolCalls, toolSummary, session as any, 1, logger,
        { contextLimit: 1000, cumulativeInputTokens: 0 },
      );

      // Second call (skipped) should have context_overflow metadata
      const skippedCall = session.addToolMessageWithId.mock.calls[1];
      expect(skippedCall[3]).toEqual(expect.objectContaining({
        success: false,
        error: 'context_overflow',
        toolName: 'Bash',
      }));
    });

    it('returns outcome with contextOverflowed=false when no overflow', () => {
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'Read', arguments: '{}' } },
      ];
      const toolSummary = {
        results: [{ executionId: 'tc-1', toolName: 'Read', success: true, result: 'ok' }],
        errors: [],
      };
      const session = { getMessages: () => [], addToolMessageWithId: vi.fn() };

      const outcome = addToolResultsToHistory(toolCalls, toolSummary, session as any, 1, logger);
      expect(outcome.contextOverflowed).toBe(false);
      expect(outcome.addedCount).toBe(1);
      expect(outcome.skippedCount).toBe(0);
    });

    it('returns outcome with contextOverflowed=true and correct counts', () => {
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'Read', arguments: '{}' } },
        { id: 'tc-2', type: 'function' as const, function: { name: 'Bash', arguments: '{}' } },
        { id: 'tc-3', type: 'function' as const, function: { name: 'Glob', arguments: '{}' } },
        { id: 'tc-4', type: 'function' as const, function: { name: 'Write', arguments: '{}' } },
      ];
      const largeContent = 'x'.repeat(3000);
      const toolSummary = {
        results: [
          { executionId: 'tc-1', toolName: 'Read', success: true, result: largeContent },
          { executionId: 'tc-2', toolName: 'Bash', success: true, result: 'small' },
          { executionId: 'tc-3', toolName: 'Glob', success: true, result: 'small' },
          { executionId: 'tc-4', toolName: 'Write', success: true, result: 'small' },
        ],
        errors: [],
      };

      const messages: Array<{ role: string; content: string }> = [];
      const session = {
        getMessages: () => messages,
        addToolMessageWithId: vi.fn((content: string) => {
          messages.push({ role: 'tool', content });
        }),
      };

      const outcome = addToolResultsToHistory(
        toolCalls, toolSummary, session as any, 1, logger,
        { contextLimit: 1000, cumulativeInputTokens: 0 },
      );

      expect(outcome.contextOverflowed).toBe(true);
      expect(outcome.addedCount).toBe(1);
      expect(outcome.skippedCount).toBe(3);
      expect(outcome.addedCount + outcome.skippedCount).toBe(toolCalls.length);
    });

    it('produces mixed results — normal results followed by context errors', () => {
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'Read', arguments: '{}' } },
        { id: 'tc-2', type: 'function' as const, function: { name: 'Bash', arguments: '{}' } },
        { id: 'tc-3', type: 'function' as const, function: { name: 'Glob', arguments: '{}' } },
      ];
      const largeContent = 'x'.repeat(3000);
      const toolSummary = {
        results: [
          { executionId: 'tc-1', toolName: 'Read', success: true, result: largeContent },
          { executionId: 'tc-2', toolName: 'Bash', success: true, result: 'bash output' },
          { executionId: 'tc-3', toolName: 'Glob', success: true, result: 'glob result' },
        ],
        errors: [],
      };

      const messages: Array<{ role: string; content: string }> = [];
      const session = {
        getMessages: () => messages,
        addToolMessageWithId: vi.fn((content: string) => {
          messages.push({ role: 'tool', content });
        }),
      };

      addToolResultsToHistory(
        toolCalls, toolSummary, session as any, 1, logger,
        { contextLimit: 1000, cumulativeInputTokens: 0 },
      );

      // All 3 tool results are in history (normal + error messages)
      expect(session.addToolMessageWithId).toHaveBeenCalledTimes(3);

      // tc-1: normal large result
      expect(session.addToolMessageWithId.mock.calls[0][0]).toBe(largeContent);

      // tc-2, tc-3: short context overflow error (much smaller than original results)
      const errorMsg2 = session.addToolMessageWithId.mock.calls[1][0] as string;
      const errorMsg3 = session.addToolMessageWithId.mock.calls[2][0] as string;
      expect(errorMsg2).toContain('Context window near capacity');
      expect(errorMsg3).toContain('Context window near capacity');

      // Error messages are short — AI can receive them without overflow
      expect(errorMsg2.length).toBeLessThan(200);
      expect(errorMsg3.length).toBeLessThan(200);
    });

    it('execution loop continues after overflow — AI sees mixed results', () => {
      // This test verifies the design intent: the execution loop does NOT break
      // when tool results overflow. Instead, AI receives normal + error results
      // and decides how to respond.
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'Read', arguments: '{}' } },
        { id: 'tc-2', type: 'function' as const, function: { name: 'Bash', arguments: '{}' } },
      ];
      const toolSummary = {
        results: [
          { executionId: 'tc-1', toolName: 'Read', success: true, result: 'x'.repeat(3000) },
          { executionId: 'tc-2', toolName: 'Bash', success: true, result: 'output' },
        ],
        errors: [],
      };

      const messages: Array<{ role: string; content: string }> = [];
      const session = {
        getMessages: () => messages,
        addToolMessageWithId: vi.fn((content: string) => {
          messages.push({ role: 'tool', content });
        }),
      };

      const outcome = addToolResultsToHistory(
        toolCalls, toolSummary, session as any, 1, logger,
        { contextLimit: 1000, cumulativeInputTokens: 0 },
      );

      // Overflow detected but all tool_result messages are in history
      expect(outcome.contextOverflowed).toBe(true);
      expect(messages).toHaveLength(2);

      // The caller (executeRound) should NOT break the loop —
      // it logs the overflow and continues to the next provider call
      // so the AI can see and respond to the mixed results
    });
  });
});
