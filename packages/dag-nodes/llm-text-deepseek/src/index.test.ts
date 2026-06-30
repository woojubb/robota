import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { INodeExecutionContext } from '@robota-sdk/dag-core';
import { LlmTextDeepSeekNodeDefinition } from './index.js';

const mockRun = vi.fn();
vi.mock('@robota-sdk/agent-core', () => ({
  Robota: vi.fn(() => ({
    run: mockRun,
  })),
}));

vi.mock('@robota-sdk/agent-provider-deepseek', () => ({
  DeepSeekProvider: vi.fn(),
}));

function createContext(config: Record<string, string | number> = {}): INodeExecutionContext {
  return {
    dagId: 'dag-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeDefinition: {
      nodeId: 'llm-1',
      nodeType: 'llm-text-deepseek',
      dependsOn: [],
      inputs: [{ key: 'text', type: 'string', required: true }],
      outputs: [{ key: 'text', type: 'string', required: true }],
      config,
    },
    nodeManifest: {
      nodeType: 'llm-text-deepseek',
      displayName: 'LLM Text DeepSeek',
      category: 'AI',
      inputs: [],
      outputs: [],
    },
    attempt: 1,
    executionPath: [],
    currentTotalCredits: 0,
  };
}

describe('LlmTextDeepSeekNodeDefinition', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('metadata', () => {
    it('has correct nodeType, displayName, and category', () => {
      const node = new LlmTextDeepSeekNodeDefinition();
      expect(node.nodeType).toBe('llm-text-deepseek');
      expect(node.displayName).toBe('LLM Text DeepSeek');
      expect(node.category).toBe('AI');
    });

    it('has text input and text output ports', () => {
      const node = new LlmTextDeepSeekNodeDefinition();
      expect(node.inputs).toEqual([
        expect.objectContaining({ key: 'text', type: 'string', required: true }),
      ]);
      expect(node.outputs).toEqual([
        expect.objectContaining({ key: 'text', type: 'string', required: true }),
      ]);
    });
  });

  describe('validateInput', () => {
    it('rejects empty prompt', async () => {
      const node = new LlmTextDeepSeekNodeDefinition();
      const result = await node.taskHandler.validateInput!({ text: '' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('rejects missing prompt', async () => {
      const node = new LlmTextDeepSeekNodeDefinition();
      const result = await node.taskHandler.validateInput!({}, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('rejects whitespace-only prompt', async () => {
      const node = new LlmTextDeepSeekNodeDefinition();
      const result = await node.taskHandler.validateInput!({ text: '   ' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('rejects disallowed model', async () => {
      const node = new LlmTextDeepSeekNodeDefinition({
        allowedModels: ['deepseek-v4-flash'],
      });
      const result = await node.taskHandler.validateInput!(
        { text: 'Hello' },
        createContext({ model: 'deepseek-r1' }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_MODEL_NOT_ALLOWED');
      }
    });

    it('accepts valid prompt with allowed model', async () => {
      const node = new LlmTextDeepSeekNodeDefinition();
      const result = await node.taskHandler.validateInput!(
        { text: 'Hello world' },
        createContext(),
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('estimateCost', () => {
    it('calculates cost based on prompt length and baseCredits', async () => {
      const node = new LlmTextDeepSeekNodeDefinition();
      const text = 'x'.repeat(500);
      const result = await node.taskHandler.estimateCost!(
        { text },
        createContext({ baseCredits: 0.01 }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.estimatedCredits).toBeCloseTo(0.01 + (500 / 4) * 0.0001, 5);
      }
    });

    it('rejects non-string prompt', async () => {
      const node = new LlmTextDeepSeekNodeDefinition();
      const result = await node.taskHandler.estimateCost!({ text: 123 }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_INVALID');
      }
    });
  });

  describe('execute', () => {
    it('returns error when DEEPSEEK_API_KEY is missing', async () => {
      delete process.env.DEEPSEEK_API_KEY;
      const node = new LlmTextDeepSeekNodeDefinition();
      const result = await node.taskHandler.execute({ text: 'Hello' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_DEEPSEEK_API_KEY_REQUIRED');
      }
    });

    it('returns error when prompt is missing with API key set', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-ds-test-key';
      const node = new LlmTextDeepSeekNodeDefinition();
      const result = await node.taskHandler.execute({}, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('returns completion on successful generation', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-ds-test-key';
      mockRun.mockResolvedValueOnce('Generated text response');

      const node = new LlmTextDeepSeekNodeDefinition();
      const result = await node.taskHandler.execute({ text: 'Hello world' }, createContext());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('Generated text response');
      }
    });

    it('returns execution error when LLM generation throws', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-ds-test-key';
      mockRun.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const node = new LlmTextDeepSeekNodeDefinition();
      const result = await node.taskHandler.execute({ text: 'Hello world' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_LLM_GENERATION_FAILED');
      }
    });

    it('rejects disallowed model during execution', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-ds-test-key';
      const node = new LlmTextDeepSeekNodeDefinition({
        allowedModels: ['deepseek-v4-flash'],
      });
      const result = await node.taskHandler.execute(
        { text: 'Hello' },
        createContext({ model: 'deepseek-r1' }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_MODEL_NOT_ALLOWED');
      }
    });
  });
});
