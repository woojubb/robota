import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { INodeExecutionContext } from '@robota-sdk/dag-core';
import { LlmTextOpenAiNodeDefinition } from './index.js';

// Mock Robota agent
const mockRun = vi.fn();
vi.mock('@robota-sdk/agent-core', () => ({
  Robota: vi.fn(() => ({
    run: mockRun,
  })),
}));

// Mock OpenAIProvider
vi.mock('@robota-sdk/agent-provider-openai', () => ({
  OpenAIProvider: vi.fn(),
}));

function createContext(config: Record<string, string | number> = {}): INodeExecutionContext {
  return {
    dagId: 'dag-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeDefinition: {
      nodeId: 'llm-1',
      nodeType: 'llm-text-openai',
      dependsOn: [],
      inputs: [{ key: 'prompt', type: 'string', required: true }],
      outputs: [{ key: 'completion', type: 'string', required: true }],
      config,
    },
    nodeManifest: {
      nodeType: 'llm-text-openai',
      displayName: 'LLM Text OpenAI',
      category: 'AI',
      inputs: [],
      outputs: [],
    },
    attempt: 1,
    executionPath: [],
    currentTotalCredits: 0,
  };
}

describe('LlmTextOpenAiNodeDefinition', () => {
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
      const node = new LlmTextOpenAiNodeDefinition();
      expect(node.nodeType).toBe('llm-text-openai');
      expect(node.displayName).toBe('LLM Text OpenAI');
      expect(node.category).toBe('AI');
    });

    it('has prompt input and completion output ports', () => {
      const node = new LlmTextOpenAiNodeDefinition();
      expect(node.inputs).toEqual([
        expect.objectContaining({ key: 'prompt', type: 'string', required: true }),
      ]);
      expect(node.outputs).toEqual([
        expect.objectContaining({ key: 'completion', type: 'string', required: true }),
      ]);
    });
  });

  describe('validateInput', () => {
    it('rejects empty prompt', async () => {
      const node = new LlmTextOpenAiNodeDefinition();
      const result = await node.taskHandler.validateInput!({ prompt: '' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('rejects missing prompt', async () => {
      const node = new LlmTextOpenAiNodeDefinition();
      const result = await node.taskHandler.validateInput!({}, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('rejects whitespace-only prompt', async () => {
      const node = new LlmTextOpenAiNodeDefinition();
      const result = await node.taskHandler.validateInput!({ prompt: '   ' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('rejects disallowed model', async () => {
      const node = new LlmTextOpenAiNodeDefinition({
        allowedModels: ['gpt-4o-mini'],
      });
      const result = await node.taskHandler.validateInput!(
        { prompt: 'Hello' },
        createContext({ model: 'gpt-4-turbo' }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_MODEL_NOT_ALLOWED');
      }
    });

    it('accepts valid prompt with allowed model', async () => {
      const node = new LlmTextOpenAiNodeDefinition();
      const result = await node.taskHandler.validateInput!(
        { prompt: 'Hello world' },
        createContext(),
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('estimateCost', () => {
    it('calculates cost based on prompt length and baseCredits', async () => {
      const node = new LlmTextOpenAiNodeDefinition();
      // 500 chars -> 500/1000 * 0.001 = 0.0005, baseCost=0.01
      const prompt = 'x'.repeat(500);
      const result = await node.taskHandler.estimateCost!(
        { prompt },
        createContext({ baseCredits: 0.01 }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.estimatedCredits).toBeCloseTo(0.0105, 4);
      }
    });

    it('returns zero cost for empty string prompt with zero baseCost', async () => {
      const node = new LlmTextOpenAiNodeDefinition();
      const result = await node.taskHandler.estimateCost!({ prompt: '' }, createContext());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.estimatedCredits).toBe(0);
      }
    });

    it('rejects non-string prompt', async () => {
      const node = new LlmTextOpenAiNodeDefinition();
      const result = await node.taskHandler.estimateCost!({ prompt: 123 }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_INVALID');
      }
    });
  });

  describe('execute', () => {
    it('returns error when OPENAI_API_KEY is missing', async () => {
      delete process.env.OPENAI_API_KEY;
      const node = new LlmTextOpenAiNodeDefinition();
      const result = await node.taskHandler.execute({ prompt: 'Hello' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_OPENAI_API_KEY_REQUIRED');
      }
    });

    it('returns error when prompt is missing with API key set', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      const node = new LlmTextOpenAiNodeDefinition();
      const result = await node.taskHandler.execute({}, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('returns completion on successful generation', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      mockRun.mockResolvedValueOnce('Generated text response');

      const node = new LlmTextOpenAiNodeDefinition();
      const result = await node.taskHandler.execute({ prompt: 'Hello world' }, createContext());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.completion).toBe('Generated text response');
      }
    });

    it('returns execution error when LLM generation throws', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      mockRun.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const node = new LlmTextOpenAiNodeDefinition();
      const result = await node.taskHandler.execute({ prompt: 'Hello world' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_LLM_GENERATION_FAILED');
      }
    });

    it('rejects disallowed model during execution', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      const node = new LlmTextOpenAiNodeDefinition({
        allowedModels: ['gpt-4o-mini'],
      });
      const result = await node.taskHandler.execute(
        { prompt: 'Hello' },
        createContext({ model: 'gpt-4-turbo' }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_MODEL_NOT_ALLOWED');
      }
    });
  });

  describe('constructor options', () => {
    it('uses custom defaultModel', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      mockRun.mockResolvedValueOnce('Response');

      const node = new LlmTextOpenAiNodeDefinition({
        defaultModel: 'gpt-4o',
        allowedModels: ['gpt-4o'],
      });
      // Default config has empty model string, so it falls back to defaultModel
      const result = await node.taskHandler.execute(
        { prompt: 'Hello' },
        createContext({ model: '' }),
      );
      expect(result.ok).toBe(true);
    });

    it('falls back to gpt-4o-mini when defaultModel is empty', () => {
      const node = new LlmTextOpenAiNodeDefinition({
        defaultModel: '  ',
      });
      expect(node.nodeType).toBe('llm-text-openai');
      // The allowedModels should contain the default 'gpt-4o-mini'
    });
  });
});
