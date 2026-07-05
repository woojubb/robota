import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IPortBinaryValue, INodeExecutionContext, TPortPayload } from '@robota-sdk/dag-core';

// Mock runtime-core to isolate the node definition from provider/poll logic
vi.mock('./runtime-core.js', () => {
  const mockGenerateVideo = vi.fn();
  return {
    SeedanceVideoRuntime: vi.fn().mockImplementation(() => ({
      generateVideo: mockGenerateVideo,
    })),
  };
});

import {
  SeedanceVideoNodeDefinition,
  SeedanceVideoConfigSchema,
  createSeedanceVideoNodeDefinition,
} from './index.js';
import { SeedanceVideoRuntime } from './runtime-core.js';

function getMockGenerateVideo(): ReturnType<typeof vi.fn> {
  const runtimeInstance = vi.mocked(SeedanceVideoRuntime).mock.results[
    vi.mocked(SeedanceVideoRuntime).mock.results.length - 1
  ]?.value as { generateVideo: ReturnType<typeof vi.fn> };
  return runtimeInstance.generateVideo;
}

function makeVideoBinary(overrides?: Partial<IPortBinaryValue>): IPortBinaryValue {
  return {
    kind: 'video',
    mimeType: 'video/mp4',
    uri: 'https://cdn.example.test/v.mp4',
    referenceType: 'uri',
    ...overrides,
  };
}

function makeExecutionContext(nodeId = 'node-1'): INodeExecutionContext {
  return {
    dagId: 'dag-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeDefinition: {
      nodeId,
      nodeType: 'seedance-video',
      dependsOn: [],
      config: {},
      inputs: [],
      outputs: [],
    },
    nodeManifest: {
      nodeType: 'seedance-video',
      displayName: 'Seedance Video',
      category: 'AI',
      inputs: [],
      outputs: [],
    },
    attempt: 1,
    executionPath: [],
    currentTotalCredits: 0,
  };
}

describe('SeedanceVideoNodeDefinition', () => {
  let node: SeedanceVideoNodeDefinition;

  beforeEach(() => {
    vi.clearAllMocks();
    node = new SeedanceVideoNodeDefinition();
  });

  describe('static properties', () => {
    it('has correct nodeType/displayName/category', () => {
      expect(node.nodeType).toBe('seedance-video');
      expect(node.displayName).toBe('Seedance Video');
      expect(node.category).toBe('AI');
    });

    it('has a required text input port and video output port', () => {
      const textInput = node.inputs.find((p) => p.key === 'text');
      expect(textInput?.required).toBe(true);
      expect(textInput?.type).toBe('string');
      const videoOutput = node.outputs.find((p) => p.key === 'video');
      expect(videoOutput).toBeDefined();
      expect(node.defaultInputPort).toBe('text');
      expect(node.defaultOutputPort).toBe('video');
    });

    it('factory returns an instance', () => {
      expect(createSeedanceVideoNodeDefinition()).toBeInstanceOf(SeedanceVideoNodeDefinition);
    });
  });

  describe('config schema', () => {
    it('applies defaults', () => {
      const parsed = SeedanceVideoConfigSchema.parse({});
      expect(parsed.model).toBe('');
      expect(parsed.baseCredits).toBe(0.5);
      expect(parsed.pollIntervalMs).toBe(5000);
      expect(parsed.maxWaitMs).toBe(300000);
    });

    it('rejects non-positive maxWaitMs', () => {
      expect(SeedanceVideoConfigSchema.safeParse({ maxWaitMs: 0 }).success).toBe(false);
    });
  });

  describe('estimateCost', () => {
    it('returns default cost estimate', async () => {
      const context = makeExecutionContext();
      context.nodeDefinition.config = {};
      const result = await node.taskHandler.estimateCost!({}, context);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.estimatedCredits).toBe(0.5);
    });

    it('returns custom cost from config', async () => {
      const context = makeExecutionContext();
      context.nodeDefinition.config = { baseCredits: 1.25 };
      const result = await node.taskHandler.estimateCost!({}, context);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.estimatedCredits).toBe(1.25);
    });
  });

  describe('execute', () => {
    it('returns validation error when prompt is missing', async () => {
      const result = await node.taskHandler.execute!({}, makeExecutionContext());
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_VIDEO_PROMPT_REQUIRED');
    });

    it('returns validation error when prompt is empty', async () => {
      const input: TPortPayload = { text: '   ' };
      const result = await node.taskHandler.execute!(input, makeExecutionContext());
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_VIDEO_PROMPT_REQUIRED');
    });

    it('returns success with video output when runtime succeeds', async () => {
      getMockGenerateVideo().mockResolvedValue({ ok: true, value: makeVideoBinary() });
      const input: TPortPayload = { text: 'a drone shot over mountains' };
      const result = await node.taskHandler.execute!(input, makeExecutionContext());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.video).toBeDefined();
    });

    it('propagates runtime error when generateVideo fails', async () => {
      getMockGenerateVideo().mockResolvedValue({
        ok: false,
        error: {
          code: 'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_JOB_FAILED',
          message: 'job failed',
          layer: 'execution',
          retryable: false,
        },
      });
      const input: TPortPayload = { text: 'a drone shot over mountains' };
      const result = await node.taskHandler.execute!(input, makeExecutionContext());
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_VIDEO_JOB_FAILED');
    });

    it('returns error when runtime returns non-video output', async () => {
      getMockGenerateVideo().mockResolvedValue({
        ok: true,
        value: { kind: 'image', mimeType: 'image/png', uri: 'asset://x' },
      });
      const input: TPortPayload = { text: 'a drone shot over mountains' };
      const result = await node.taskHandler.execute!(input, makeExecutionContext());
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_VIDEO_OUTPUT_INVALID');
    });
  });

  describe('construction with options', () => {
    it('passes options to SeedanceVideoRuntime', () => {
      const options = { apiKey: 'k', baseUrl: 'https://api.test', defaultModel: 'seedance-2.0' };
      new SeedanceVideoNodeDefinition(options);
      expect(SeedanceVideoRuntime).toHaveBeenCalledWith(options);
    });
  });
});
