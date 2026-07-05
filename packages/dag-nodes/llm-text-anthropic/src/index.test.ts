import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { INodeExecutionContext } from '@robota-sdk/dag-core';
import { LlmTextAnthropicNodeDefinition } from './index.js';

const mockRun = vi.fn();
vi.mock('@robota-sdk/agent-core', () => ({
  Robota: vi.fn(() => ({
    run: mockRun,
  })),
}));

vi.mock('@robota-sdk/agent-provider/anthropic', () => ({
  AnthropicProvider: vi.fn(),
}));

function createContext(config: Record<string, string | number> = {}): INodeExecutionContext {
  return {
    dagId: 'dag-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeDefinition: {
      nodeId: 'llm-1',
      nodeType: 'llm-text-anthropic',
      dependsOn: [],
      inputs: [{ key: 'text', type: 'string', required: true }],
      outputs: [{ key: 'text', type: 'string', required: true }],
      config,
    },
    nodeManifest: {
      nodeType: 'llm-text-anthropic',
      displayName: 'LLM Text Anthropic',
      category: 'AI',
      inputs: [],
      outputs: [],
    },
    attempt: 1,
    executionPath: [],
    currentTotalCredits: 0,
  };
}

describe('LlmTextAnthropicNodeDefinition', () => {
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
      const node = new LlmTextAnthropicNodeDefinition();
      expect(node.nodeType).toBe('llm-text-anthropic');
      expect(node.displayName).toBe('LLM Text Anthropic');
      expect(node.category).toBe('AI');
    });

    it('has text input and text output ports', () => {
      const node = new LlmTextAnthropicNodeDefinition();
      expect(node.inputs).toEqual([
        expect.objectContaining({ key: 'text', type: 'string', required: true }),
      ]);
      expect(node.outputs).toEqual([
        expect.objectContaining({ key: 'text', type: 'string', required: true }),
      ]);
    });

    it('has defaultInputPort and defaultOutputPort set to text', () => {
      const node = new LlmTextAnthropicNodeDefinition();
      expect(node.defaultInputPort).toBe('text');
      expect(node.defaultOutputPort).toBe('text');
    });
  });

  describe('validateInput', () => {
    it('rejects empty text', async () => {
      const node = new LlmTextAnthropicNodeDefinition();
      const result = await node.taskHandler.validateInput!({ text: '' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('rejects missing text', async () => {
      const node = new LlmTextAnthropicNodeDefinition();
      const result = await node.taskHandler.validateInput!({}, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('rejects whitespace-only text', async () => {
      const node = new LlmTextAnthropicNodeDefinition();
      const result = await node.taskHandler.validateInput!({ text: '   ' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('rejects disallowed model', async () => {
      const node = new LlmTextAnthropicNodeDefinition({
        allowedModels: ['claude-sonnet-4-6'],
      });
      const result = await node.taskHandler.validateInput!(
        { text: 'Hello' },
        createContext({ model: 'claude-opus-4' }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_MODEL_NOT_ALLOWED');
      }
    });

    it('accepts valid text with allowed model', async () => {
      const node = new LlmTextAnthropicNodeDefinition();
      const result = await node.taskHandler.validateInput!(
        { text: 'Hello world' },
        createContext(),
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('estimateCost', () => {
    it('calculates cost based on text length and baseCredits', async () => {
      const node = new LlmTextAnthropicNodeDefinition();
      const text = 'x'.repeat(500);
      const result = await node.taskHandler.estimateCost!(
        { text },
        createContext({ baseCredits: 0.01 }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.estimatedCredits).toBeCloseTo(0.01 + (500 / 4) * 0.003, 4);
      }
    });

    it('rejects non-string text', async () => {
      const node = new LlmTextAnthropicNodeDefinition();
      const result = await node.taskHandler.estimateCost!({ text: 123 }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_INVALID');
      }
    });
  });

  describe('execute', () => {
    it('returns error when ANTHROPIC_API_KEY is missing', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const node = new LlmTextAnthropicNodeDefinition();
      const result = await node.taskHandler.execute({ text: 'Hello' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_ANTHROPIC_API_KEY_REQUIRED');
      }
    });

    it('returns error when text is missing with API key set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      const node = new LlmTextAnthropicNodeDefinition();
      const result = await node.taskHandler.execute({}, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
      }
    });

    it('returns text output on successful generation', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      mockRun.mockResolvedValueOnce('Generated text response');

      const node = new LlmTextAnthropicNodeDefinition();
      const result = await node.taskHandler.execute({ text: 'Hello world' }, createContext());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('Generated text response');
      }
    });

    it('returns execution error when LLM generation throws', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      mockRun.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const node = new LlmTextAnthropicNodeDefinition();
      const result = await node.taskHandler.execute({ text: 'Hello world' }, createContext());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_LLM_GENERATION_FAILED');
      }
    });

    it('rejects disallowed model during execution', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      const node = new LlmTextAnthropicNodeDefinition({
        allowedModels: ['claude-sonnet-4-6'],
      });
      const result = await node.taskHandler.execute(
        { text: 'Hello' },
        createContext({ model: 'claude-opus-4' }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_LLM_MODEL_NOT_ALLOWED');
      }
    });
  });
});
