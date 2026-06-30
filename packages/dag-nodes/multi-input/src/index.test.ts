import { describe, expect, it } from 'vitest';
import type { INodeExecutionContext, INodeConfigObject } from '@robota-sdk/dag-core';
import { MultiInputNodeDefinition } from './index.js';

function createContext(config: INodeConfigObject = {}): INodeExecutionContext {
  return {
    dagId: 'dag-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeDefinition: {
      nodeId: 'multi-input-1',
      nodeType: 'multi-input',
      dependsOn: [],
      inputs: [],
      outputs: [],
      config,
    },
    nodeManifest: {
      nodeType: 'multi-input',
      displayName: 'Multi-Input',
      category: 'Core',
      inputs: [],
      outputs: [],
    },
    attempt: 1,
    executionPath: ['dagId:dag-1', 'dagRunId:run-1', 'nodeId:multi-input-1', 'attempt:1'],
    currentTotalCredits: 0,
  };
}

describe('MultiInputNodeDefinition', () => {
  it('has correct metadata', () => {
    const node = new MultiInputNodeDefinition();
    expect(node.nodeType).toBe('multi-input');
    expect(node.displayName).toBe('Multi-Input');
    expect(node.category).toBe('Core');
    expect(node.inputs).toHaveLength(0);
    expect(node.outputs).toHaveLength(0);
  });

  it('emits configured ports from runtime input', async () => {
    const node = new MultiInputNodeDefinition();
    const result = await node.taskHandler.execute(
      { prompt: 'hello', context: 'world' },
      createContext({ ports: ['prompt', 'context'] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prompt).toBe('hello');
      expect(result.value.context).toBe('world');
    }
  });

  it('falls back to config.values when runtime input key is missing', async () => {
    const node = new MultiInputNodeDefinition();
    const result = await node.taskHandler.execute(
      {},
      createContext({ ports: ['prompt'], values: { prompt: 'default text' } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prompt).toBe('default text');
    }
  });

  it('runtime input takes priority over config.values', async () => {
    const node = new MultiInputNodeDefinition();
    const result = await node.taskHandler.execute(
      { prompt: 'runtime value' },
      createContext({ ports: ['prompt'], values: { prompt: 'config default' } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prompt).toBe('runtime value');
    }
  });

  it('infers ports from config.values when ports is empty', async () => {
    const node = new MultiInputNodeDefinition();
    const result = await node.taskHandler.execute(
      {},
      createContext({ values: { a: 'alpha', b: 'beta' } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.a).toBe('alpha');
      expect(result.value.b).toBe('beta');
    }
  });

  it('emits _agentSummary', async () => {
    const node = new MultiInputNodeDefinition();
    const result = await node.taskHandler.execute(
      { prompt: 'hi' },
      createContext({ ports: ['prompt'] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.value._agentSummary).toBe('string');
      expect(result.value._agentSummary).toContain('prompt');
    }
  });

  it('estimates cost as zero', async () => {
    const node = new MultiInputNodeDefinition();
    const result = await node.taskHandler.estimateCost!({}, createContext());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.estimatedCredits).toBe(0);
    }
  });
});
