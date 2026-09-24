import { describe, expect, it } from 'vitest';
import type { INodeExecutionContext } from '@robota-sdk/dag-core';
import { TransformNodeDefinition } from './index.js';

function createContext(prefix = 'PREFIX: '): INodeExecutionContext {
  return {
    executionRoot: '/test/execution-root',
    dagId: 'dag-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeDefinition: {
      nodeId: 'transform-1',
      nodeType: 'transform',
      dependsOn: [],
      inputs: [
        { key: 'text', type: 'string', required: false },
        { key: 'data', type: 'object', required: false },
      ],
      outputs: [
        { key: 'text', type: 'string', required: false },
        { key: 'data', type: 'object', required: false },
      ],
      config: { prefix },
    },
    nodeManifest: {
      nodeType: 'transform',
      displayName: 'Transform',
      category: 'Core',
      inputs: [],
      outputs: [],
    },
    attempt: 1,
    executionPath: [],
    currentTotalCredits: 0,
  };
}

describe('TransformNodeDefinition', () => {
  it('has correct metadata', () => {
    const node = new TransformNodeDefinition();
    expect(node.nodeType).toBe('transform');
    expect(node.category).toBe('Core');
  });

  it('prepends prefix to text input', async () => {
    const node = new TransformNodeDefinition();
    const result = await node.taskHandler.execute({ text: 'hello' }, createContext('PREFIX: '));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('PREFIX: hello');
    }
  });

  it('uses exact UTF-8 bytes across a prefix/input surrogate boundary', async () => {
    const node = new TransformNodeDefinition();
    const context = {
      ...createContext('\ud83d'),
      byteLimits: { maxTextRepeatOutputBytes: 4_194_304, maxTextTransformOutputBytes: 4 },
    };
    const accepted = await node.taskHandler.execute({ text: '\ude00' }, context);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.value.text).toBe('😀');

    const refused = await node.taskHandler.execute({ text: '\ude00' }, {
      ...context,
      byteLimits: { ...context.byteLimits, maxTextTransformOutputBytes: 3 },
    });
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED' },
    });
  });

  it('passes through all input entries when text is not string', async () => {
    const node = new TransformNodeDefinition();
    const result = await node.taskHandler.execute({ data: { key: 'value' } }, createContext());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data).toEqual({ key: 'value' });
    }
  });

  it('validates input rejects empty input', async () => {
    const node = new TransformNodeDefinition();
    const result = await node.taskHandler.validateInput!({}, createContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_TRANSFORM_INPUT_REQUIRED');
    }
  });

  it('estimates cost as 0.0001', async () => {
    const node = new TransformNodeDefinition();
    const result = await node.taskHandler.estimateCost!({}, createContext());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.estimatedCredits).toBe(0.0001);
    }
  });
});
