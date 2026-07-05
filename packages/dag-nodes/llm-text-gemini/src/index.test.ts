import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { INodeExecutionContext } from '@robota-sdk/dag-core';
import { LlmTextGeminiNodeDefinition } from './index.js';

const mockRun = vi.fn();
vi.mock('@robota-sdk/agent-core', () => ({
  Robota: vi.fn(() => ({
    run: mockRun,
  })),
}));

vi.mock('@robota-sdk/agent-provider/google', () => ({
  GoogleProvider: vi.fn(),
}));

function createContext(config: Record<string, string | number> = {}): INodeExecutionContext {
  return {
    dagId: 'dag-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeDefinition: {
      nodeId: 'llm-1',
      nodeType: 'llm-text-gemini',
      dependsOn: [],
      inputs: [{ key: 'text', type: 'string', required: true }],
      outputs: [{ key: 'text', type: 'string', required: true }],
      config,
    },
    nodeManifest: {
      nodeType: 'llm-text-gemini',
      displayName: 'LLM Text Gemini',
      category: 'AI',
      inputs: [],
      outputs: [],
    },
    attempt: 1,
    executionPath: [],
    currentTotalCredits: 0,
  };
}

describe('LlmTextGeminiNodeDefinition', () => {
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
      const node = new LlmTextGeminiNodeDefinition();
      expect(node.nodeType).toBe('llm-text-gemini');
      expect(node.displayName).toBe('LLM Text Gemini');
      expect(node.category).toBe('AI');
    });

    it('has text input and text output ports', () => {
      const node = new LlmTextGeminiNodeDefinition();
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
      const node = new LlmTextGeminiNodeDefinition();
      const result = await node.taskHandler.validateInput!({ text: '' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('rejects missing prompt', async () => {
      const node = new LlmTextGeminiNodeDefinition();
      const result = await node.taskHandler.validateInput!({}, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('rejects whitespace-only prompt', async () => {
      const node = new LlmTextGeminiNodeDefinition();
      const result = await node.taskHandler.validateInput!({ text: '   ' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('rejects disallowed model', async () => {
      const node = new LlmTextGeminiNodeDefinition({
        allowedModels: ['gemini-2.0-flash'],
      });
      const result = await node.taskHandler.validateInput!(
        { text: 'Hello' },
        createContext({ model: 'gemini-1.5-pro' }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_MODEL_NOT_ALLOWED');
      }
    });

    it('accepts valid prompt with allowed model', async () => {
      const node = new LlmTextGeminiNodeDefinition();
      const result = await node.taskHandler.validateInput!(
        { text: 'Hello world' },
        createContext(),
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('estimateCost', () => {
    it('calculates cost based on prompt length and baseCredits', async () => {
      const node = new LlmTextGeminiNodeDefinition();
      const text = 'x'.repeat(500);
      const result = await node.taskHandler.estimateCost!(
        { text },
        createContext({ baseCredits: 0.01 }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.estimatedCredits).toBeCloseTo(0.01 + (500 / 4) * 0.0005, 5);
      }
    });

    it('rejects non-string prompt', async () => {
      const node = new LlmTextGeminiNodeDefinition();
      const result = await node.taskHandler.estimateCost!({ text: 123 }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_INVALID');
      }
    });
  });

  describe('execute', () => {
    it('returns error when GEMINI_API_KEY is missing', async () => {
      delete process.env.GEMINI_API_KEY;
      const node = new LlmTextGeminiNodeDefinition();
      const result = await node.taskHandler.execute({ text: 'Hello' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_API_KEY_REQUIRED');
      }
    });

    it('returns error when prompt is missing with API key set', async () => {
      process.env.GEMINI_API_KEY = 'AIza-test-key';
      const node = new LlmTextGeminiNodeDefinition();
      const result = await node.taskHandler.execute({}, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('returns completion on successful generation', async () => {
      process.env.GEMINI_API_KEY = 'AIza-test-key';
      mockRun.mockResolvedValueOnce('Generated text response');

      const node = new LlmTextGeminiNodeDefinition();
      const result = await node.taskHandler.execute({ text: 'Hello world' }, createContext());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('Generated text response');
      }
    });

    it('returns execution error when LLM generation throws', async () => {
      process.env.GEMINI_API_KEY = 'AIza-test-key';
      mockRun.mockRejectedValueOnce(new Error('API quota exceeded'));

      const node = new LlmTextGeminiNodeDefinition();
      const result = await node.taskHandler.execute({ text: 'Hello world' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_LLM_GENERATION_FAILED');
      }
    });

    it('rejects disallowed model during execution', async () => {
      process.env.GEMINI_API_KEY = 'AIza-test-key';
      const node = new LlmTextGeminiNodeDefinition({
        allowedModels: ['gemini-2.0-flash'],
      });
      const result = await node.taskHandler.execute(
        { text: 'Hello' },
        createContext({ model: 'gemini-1.5-pro' }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_MODEL_NOT_ALLOWED');
      }
    });
  });
});
