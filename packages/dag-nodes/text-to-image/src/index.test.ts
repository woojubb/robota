import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IPortBinaryValue, INodeExecutionContext, TPortPayload } from '@robota-sdk/dag-core';

// Mock runtime-core to isolate the node definition from provider logic
vi.mock('./runtime-core.js', () => {
  const mockGenerateImage = vi.fn();
  return {
    TextToImageRuntime: vi.fn().mockImplementation(() => ({
      generateImage: mockGenerateImage,
    })),
  };
});

import {
  TextToImageNodeDefinition,
  TextToImageConfigSchema,
  createTextToImageNodeDefinition,
} from './index.js';
import { TextToImageRuntime } from './runtime-core.js';

function getMockGenerateImage(): ReturnType<typeof vi.fn> {
  const runtimeInstance = vi.mocked(TextToImageRuntime).mock.results[
    vi.mocked(TextToImageRuntime).mock.results.length - 1
  ]?.value as { generateImage: ReturnType<typeof vi.fn> };
  return runtimeInstance.generateImage;
}

function makeImageBinary(overrides?: Partial<IPortBinaryValue>): IPortBinaryValue {
  return { kind: 'image', mimeType: 'image/png', uri: 'data:image/png;base64,iVBOR', ...overrides };
}

function makeExecutionContext(nodeId = 'node-1'): INodeExecutionContext {
  return {
    dagId: 'dag-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeDefinition: {
      nodeId,
      nodeType: 'text-to-image',
      dependsOn: [],
      config: {},
      inputs: [],
      outputs: [],
    },
    nodeManifest: {
      nodeType: 'text-to-image',
      displayName: 'Text to Image',
      category: 'AI',
      inputs: [],
      outputs: [],
    },
    attempt: 1,
    executionPath: [],
    currentTotalCredits: 0,
  };
}

describe('TextToImageNodeDefinition', () => {
  let node: TextToImageNodeDefinition;

  beforeEach(() => {
    vi.clearAllMocks();
    node = new TextToImageNodeDefinition();
  });

  describe('static properties', () => {
    it('has correct nodeType/displayName/category', () => {
      expect(node.nodeType).toBe('text-to-image');
      expect(node.displayName).toBe('Text to Image');
      expect(node.category).toBe('AI');
    });

    it('has a required text input port and image output port', () => {
      const textInput = node.inputs.find((p) => p.key === 'text');
      expect(textInput?.required).toBe(true);
      expect(textInput?.type).toBe('string');
      expect(node.inputs.find((p) => p.key === 'image')).toBeUndefined();
      expect(node.outputs.find((p) => p.key === 'image')).toBeDefined();
      expect(node.defaultInputPort).toBe('text');
      expect(node.defaultOutputPort).toBe('image');
    });

    it('factory returns an instance', () => {
      expect(createTextToImageNodeDefinition()).toBeInstanceOf(TextToImageNodeDefinition);
    });
  });

  describe('config schema', () => {
    it('applies defaults', () => {
      const parsed = TextToImageConfigSchema.parse({});
      expect(parsed.model).toBe('');
      expect(parsed.baseCredits).toBe(0.02);
    });
  });

  describe('estimateCost', () => {
    it('returns default cost estimate', async () => {
      const context = makeExecutionContext();
      context.nodeDefinition.config = {};
      const result = await node.taskHandler.estimateCost!({}, context);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.estimatedCredits).toBe(0.02);
    });

    it('returns custom cost from config', async () => {
      const context = makeExecutionContext();
      context.nodeDefinition.config = { baseCredits: 0.05 };
      const result = await node.taskHandler.estimateCost!({}, context);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.estimatedCredits).toBe(0.05);
    });
  });

  describe('execute', () => {
    it('returns validation error when prompt is missing', async () => {
      const result = await node.taskHandler.execute!({}, makeExecutionContext());
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe('DAG_VALIDATION_TEXT_TO_IMAGE_PROMPT_REQUIRED');
    });

    it('returns validation error when prompt is empty', async () => {
      const input: TPortPayload = { text: '   ' };
      const result = await node.taskHandler.execute!(input, makeExecutionContext());
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe('DAG_VALIDATION_TEXT_TO_IMAGE_PROMPT_REQUIRED');
    });

    it('returns success with image output when runtime succeeds', async () => {
      getMockGenerateImage().mockResolvedValue({
        ok: true,
        value: makeImageBinary({ uri: 'data:image/png;base64,RESULT' }),
      });
      const input: TPortPayload = { text: 'a red bicycle' };
      const result = await node.taskHandler.execute!(input, makeExecutionContext());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.image).toBeDefined();
    });

    it('propagates runtime error when generateImage fails', async () => {
      getMockGenerateImage().mockResolvedValue({
        ok: false,
        error: {
          code: 'DAG_TASK_EXECUTION_TEXT_TO_IMAGE_FAILED',
          message: 'Generation failed',
          layer: 'execution',
          retryable: false,
        },
      });
      const input: TPortPayload = { text: 'a red bicycle' };
      const result = await node.taskHandler.execute!(input, makeExecutionContext());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('DAG_TASK_EXECUTION_TEXT_TO_IMAGE_FAILED');
    });

    it('returns error when runtime returns non-image output', async () => {
      getMockGenerateImage().mockResolvedValue({
        ok: true,
        value: { kind: 'audio', mimeType: 'audio/mp3', uri: 'asset://x' },
      });
      const input: TPortPayload = { text: 'a red bicycle' };
      const result = await node.taskHandler.execute!(input, makeExecutionContext());
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_TEXT_TO_IMAGE_OUTPUT_INVALID');
    });
  });

  describe('construction with options', () => {
    it('passes options to TextToImageRuntime', () => {
      const options = { apiKey: 'key-123', defaultModel: 'model-x' };
      new TextToImageNodeDefinition(options);
      expect(TextToImageRuntime).toHaveBeenCalledWith(options);
    });
  });
});
