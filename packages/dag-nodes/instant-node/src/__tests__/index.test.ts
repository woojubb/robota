import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@robota-sdk/agent-core', () => ({
  Robota: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue('mocked response'),
  })),
}));

vi.mock('@robota-sdk/agent-provider/anthropic', () => ({
  AnthropicProvider: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@robota-sdk/agent-provider/openai', () => ({
  OpenAIProvider: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@robota-sdk/agent-provider/google', () => ({
  GoogleProvider: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@robota-sdk/agent-provider/deepseek', () => ({
  DeepSeekProvider: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@robota-sdk/agent-provider/qwen', () => ({
  QwenProvider: vi.fn().mockImplementation(() => ({})),
}));

import { createPromptBackedNodeDefinition, PromptBackedNodeDefinition } from '../index.js';
import type { ICreatePromptNodeInput } from '../index.js';
import type { INodeExecutionContext, TPortPayload } from '@robota-sdk/dag-core';

const MOCK_CONTEXT: INodeExecutionContext = {
  dagId: 'test-dag',
  dagRunId: 'test-run',
  taskRunId: 'test-task',
  nodeDefinition: {
    nodeId: 'test-node',
    nodeType: 'my-custom-node',
    dependsOn: [],
    config: {},
  },
  nodeManifest: {
    nodeType: 'my-custom-node',
    displayName: 'My Custom Node',
    category: 'Instant',
    inputs: [],
    outputs: [],
  },
  attempt: 0,
  executionPath: [],
  currentTotalCredits: 0,
};

const SINGLE_PORT_SPEC: ICreatePromptNodeInput = {
  nodeType: 'my-custom-node',
  displayName: 'My Custom Node',
  systemPromptTemplate: 'Translate to French: {{text}}',
  inputPorts: [{ key: 'text', description: 'Input text' }],
  outputPort: { key: 'text', description: 'Translated text' },
  provider: 'anthropic',
};

describe('createPromptBackedNodeDefinition', () => {
  it('returns a PromptBackedNodeDefinition instance', () => {
    const node = createPromptBackedNodeDefinition(SINGLE_PORT_SPEC);
    expect(node).toBeInstanceOf(PromptBackedNodeDefinition);
  });

  it('sets nodeType from spec', () => {
    const node = createPromptBackedNodeDefinition(SINGLE_PORT_SPEC);
    expect(node.nodeType).toBe('my-custom-node');
  });

  it('sets displayName from spec', () => {
    const node = createPromptBackedNodeDefinition(SINGLE_PORT_SPEC);
    expect(node.displayName).toBe('My Custom Node');
  });

  it('sets category to Instant', () => {
    const node = createPromptBackedNodeDefinition(SINGLE_PORT_SPEC);
    expect(node.category).toBe('Instant');
  });

  it('builds inputs from inputPorts', () => {
    const node = createPromptBackedNodeDefinition(SINGLE_PORT_SPEC);
    expect(node.inputs).toHaveLength(1);
    expect(node.inputs[0]).toMatchObject({ key: 'text', type: 'string', required: true });
  });

  it('builds outputs from outputPort', () => {
    const node = createPromptBackedNodeDefinition(SINGLE_PORT_SPEC);
    expect(node.outputs).toHaveLength(1);
    expect(node.outputs[0]).toMatchObject({ key: 'text', type: 'string', required: true });
  });

  it('sets defaultInputPort to first input port key', () => {
    const node = createPromptBackedNodeDefinition(SINGLE_PORT_SPEC);
    expect(node.defaultInputPort).toBe('text');
  });

  it('sets defaultOutputPort to output port key', () => {
    const node = createPromptBackedNodeDefinition(SINGLE_PORT_SPEC);
    expect(node.defaultOutputPort).toBe('text');
  });

  it('each instance has independent nodeType', () => {
    const nodeA = createPromptBackedNodeDefinition({ ...SINGLE_PORT_SPEC, nodeType: 'node-a' });
    const nodeB = createPromptBackedNodeDefinition({ ...SINGLE_PORT_SPEC, nodeType: 'node-b' });
    expect(nodeA.nodeType).toBe('node-a');
    expect(nodeB.nodeType).toBe('node-b');
  });
});

describe('PromptBackedNodeDefinition.taskHandler.execute', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV, ANTHROPIC_API_KEY: 'test-key' };
  });

  it('renders template and returns output on success', async () => {
    const node = createPromptBackedNodeDefinition(SINGLE_PORT_SPEC);
    const input: TPortPayload = { text: 'hello world' };
    const result = await node.taskHandler.execute(input, MOCK_CONTEXT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveProperty('text', 'mocked response');
    }
  });

  it('returns validation error when required input port is missing', async () => {
    const node = createPromptBackedNodeDefinition(SINGLE_PORT_SPEC);
    const result = await node.taskHandler.execute({}, MOCK_CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_MISSING');
    }
  });

  it('returns validation error when API key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const node = createPromptBackedNodeDefinition(SINGLE_PORT_SPEC);
    const result = await node.taskHandler.execute({ text: 'hello' }, MOCK_CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_INSTANT_NODE_API_KEY_REQUIRED');
    }
  });

  it('multi-port spec renders all variables into template', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const multiSpec: ICreatePromptNodeInput = {
      nodeType: 'multi-port-node',
      displayName: 'Multi Port',
      systemPromptTemplate: 'Name: {{name}}, Age: {{age}}',
      inputPorts: [{ key: 'name' }, { key: 'age' }],
      outputPort: { key: 'result' },
      provider: 'anthropic',
    };
    const node = createPromptBackedNodeDefinition(multiSpec);
    const result = await node.taskHandler.execute(
      { name: 'Alice', age: '30' },
      { ...MOCK_CONTEXT, nodeDefinition: { ...MOCK_CONTEXT.nodeDefinition, nodeId: 'multi' } },
    );
    expect(result.ok).toBe(true);
  });
});
