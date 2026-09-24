import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRun = vi.hoisted(() => vi.fn().mockResolvedValue('mocked response'));

// Only the agent entrypoint is stubbed. Provider construction is supplied through the injected
// provider-definition registry, which keeps this leaf test independent of vendor SDK packages.
vi.mock('@robota-sdk/agent-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@robota-sdk/agent-core')>()),
  Robota: vi.fn().mockImplementation(() => ({
    run: mockRun,
  })),
}));

import {
  createPromptBackedNodeDefinition,
  PromptBackedNodeDefinition,
  createCompositeInstantNodeDefinition,
} from '../index.js';
import type { ICreatePromptNodeInput } from '../index.js';
import type { IDagDefinition, INodeExecutionContext, TPortPayload } from '@robota-sdk/dag-core';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

const TEST_PROVIDERS: readonly IProviderDefinition[] = [
  {
    type: 'anthropic',
    defaults: { model: 'test-model', apiKey: '$ENV:ANTHROPIC_API_KEY' },
    credentialRequirement: { anyOf: ['apiKey'] },
    createProvider: () => ({ name: 'anthropic' }) as never,
  },
];

function createTestNode(spec: ICreatePromptNodeInput = SINGLE_PORT_SPEC) {
  return createPromptBackedNodeDefinition(spec, TEST_PROVIDERS);
}

const MOCK_CONTEXT: INodeExecutionContext = {
  executionRoot: '/test/execution-root',
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
    const node = createTestNode();
    expect(node).toBeInstanceOf(PromptBackedNodeDefinition);
  });

  it('sets nodeType from spec', () => {
    const node = createTestNode();
    expect(node.nodeType).toBe('my-custom-node');
  });

  it('sets displayName from spec', () => {
    const node = createTestNode();
    expect(node.displayName).toBe('My Custom Node');
  });

  it('sets category to Instant', () => {
    const node = createTestNode();
    expect(node.category).toBe('Instant');
  });

  it('builds inputs from inputPorts', () => {
    const node = createTestNode();
    expect(node.inputs).toHaveLength(1);
    expect(node.inputs[0]).toMatchObject({ key: 'text', type: 'string', required: true });
  });

  it('builds outputs from outputPort', () => {
    const node = createTestNode();
    expect(node.outputs).toHaveLength(1);
    expect(node.outputs[0]).toMatchObject({ key: 'text', type: 'string', required: true });
  });

  it('sets defaultInputPort to first input port key', () => {
    const node = createTestNode();
    expect(node.defaultInputPort).toBe('text');
  });

  it('sets defaultOutputPort to output port key', () => {
    const node = createTestNode();
    expect(node.defaultOutputPort).toBe('text');
  });

  it('each instance has independent nodeType', () => {
    const nodeA = createTestNode({ ...SINGLE_PORT_SPEC, nodeType: 'node-a' });
    const nodeB = createTestNode({ ...SINGLE_PORT_SPEC, nodeType: 'node-b' });
    expect(nodeA.nodeType).toBe('node-a');
    expect(nodeB.nodeType).toBe('node-b');
  });
});

describe('PromptBackedNodeDefinition.taskHandler.execute', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('forwards cancellation and discards a provider response returned after abort', async () => {
    const controller = new AbortController();
    mockRun.mockImplementationOnce(async (_prompt, options) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      return 'late response';
    });
    const result = await createTestNode().taskHandler.execute(
      { text: 'hello' },
      { ...MOCK_CONTEXT, signal: controller.signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'DAG_TASK_EXECUTION_CANCELLED',
        retryable: false,
      },
    });
  });

  it('renders template and returns output on success', async () => {
    const node = createTestNode();
    const input: TPortPayload = { text: 'hello world' };
    const result = await node.taskHandler.execute(input, MOCK_CONTEXT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveProperty('text', 'mocked response');
    }
  });

  it('returns validation error when required input port is missing', async () => {
    const node = createTestNode();
    const result = await node.taskHandler.execute({}, MOCK_CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_MISSING');
    }
  });

  it('returns validation error when API key is missing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    const node = createTestNode();
    const result = await node.taskHandler.execute({ text: 'hello' }, MOCK_CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_INSTANT_NODE_API_KEY_REQUIRED');
    }
  });

  it('multi-port spec renders all variables into template', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const multiSpec: ICreatePromptNodeInput = {
      nodeType: 'multi-port-node',
      displayName: 'Multi Port',
      systemPromptTemplate: 'Name: {{name}}, Age: {{age}}',
      inputPorts: [{ key: 'name' }, { key: 'age' }],
      outputPort: { key: 'result' },
      provider: 'anthropic',
    };
    const node = createTestNode(multiSpec);
    const result = await node.taskHandler.execute(
      { name: 'Alice', age: '30' },
      { ...MOCK_CONTEXT, nodeDefinition: { ...MOCK_CONTEXT.nodeDefinition, nodeId: 'multi' } },
    );
    expect(result.ok).toBe(true);
  });
});

describe('persistence view (BEHAVIOR-006)', () => {
  it('PromptBackedNodeDefinition.toPersisted() returns a prompt record', () => {
    const node = createTestNode({
      nodeType: 'p',
      displayName: 'P',
      systemPromptTemplate: 'Hi {{text}}',
      inputPorts: [{ key: 'text' }],
      outputPort: { key: 'out' },
      provider: 'openai',
      model: 'gpt',
    });
    expect(node.toPersisted()).toEqual({
      kind: 'prompt',
      nodeType: 'p',
      displayName: 'P',
      systemPromptTemplate: 'Hi {{text}}',
      inputPorts: [{ key: 'text' }],
      outputPort: { key: 'out' },
      provider: 'openai',
      model: 'gpt',
    });
  });

  it('CompositeInstantNodeDefinition.toPersisted() returns a composite record without the runner', () => {
    const innerDag = {
      dagId: 'd',
      version: 1,
      status: 'draft',
      nodes: [],
      edges: [],
    } as unknown as IDagDefinition;
    const node = createCompositeInstantNodeDefinition({
      nodeType: 'c',
      displayName: 'C',
      innerDag,
      exposedInputPort: { key: 'text', mapsTo: { nodeId: 'in', portKey: 'text' } },
      exposedOutputPorts: [{ key: 'result', mapsTo: { nodeId: 'out', portKey: 'text' } }],
      runner: { run: async () => ({ ok: true, outputs: {} }) },
    });
    const persisted = node.toPersisted();
    expect(persisted.kind).toBe('composite');
    expect('runner' in persisted).toBe(false);
    expect(persisted).toMatchObject({
      kind: 'composite',
      nodeType: 'c',
      innerDag,
      exposedInputPort: { key: 'text', mapsTo: { nodeId: 'in', portKey: 'text' } },
      exposedOutputPorts: [{ key: 'result', mapsTo: { nodeId: 'out', portKey: 'text' } }],
    });
  });
});

describe('composite nested-run lineage', () => {
  function composite(
    nodeType: string,
    innerTypes: string[],
    runner: ReturnType<typeof vi.fn>,
    maxDepth?: number,
  ) {
    const innerDag = {
      dagId: `inner-${nodeType}`,
      version: 1,
      status: 'draft',
      nodes: innerTypes.map((type, index) => ({
        nodeId: `inner-${index}`,
        nodeType: type,
        dependsOn: [],
        config: {},
      })),
      edges: [],
    } as unknown as IDagDefinition;
    return createCompositeInstantNodeDefinition({
      nodeType,
      displayName: nodeType,
      innerDag,
      exposedInputPort: { key: 'text', mapsTo: { nodeId: 'inner-0', portKey: 'text' } },
      exposedOutputPorts: [{ key: 'result', mapsTo: { nodeId: 'inner-0', portKey: 'text' } }],
      runner: { run: runner },
      ...(maxDepth === undefined ? {} : { maxDepth }),
    });
  }

  function context(nodeType: string, lineage?: object): INodeExecutionContext {
    return {
      ...MOCK_CONTEXT,
      nodeDefinition: { ...MOCK_CONTEXT.nodeDefinition, nodeType },
      ...(lineage ? { lineage } : {}),
    } as INodeExecutionContext;
  }

  it('rejects direct recursion before launching a child', async () => {
    const runner = vi.fn(async () => ({ ok: true, outputs: {} }));
    const node = composite('recursive', ['recursive'], runner);
    const result = await node.taskHandler.execute({ text: 'x' }, context('recursive'));
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_COMPOSITE_RECURSION' },
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects indirect recursion through an ancestor type before launching a child', async () => {
    const runner = vi.fn(async () => ({ ok: true, outputs: {} }));
    const node = composite('second', ['first'], runner);
    const result = await node.taskHandler.execute(
      { text: 'x' },
      context('second', {
        rootRunId: 'root',
        parentRunId: 'root',
        depth: 1,
        ancestorCompositeNodeTypes: ['first'],
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_COMPOSITE_RECURSION' },
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects a child launch beyond the declared depth', async () => {
    const runner = vi.fn(async () => ({ ok: true, outputs: {} }));
    const node = composite('bounded', ['input'], runner, 2);
    const result = await node.taskHandler.execute(
      { text: 'x' },
      context('bounded', {
        rootRunId: 'root',
        parentRunId: 'parent',
        depth: 2,
        ancestorCompositeNodeTypes: ['first', 'second'],
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_COMPOSITE_DEPTH_EXCEEDED' },
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('passes immutable root/parent lineage to a child runner', async () => {
    const runner = vi.fn(async () => ({ ok: true, outputs: {} }));
    const node = composite('bounded', ['input'], runner);
    const ctx = context('bounded');
    ctx.snapshotBudget = { admit: vi.fn(), admitValue: vi.fn(), admitRun: vi.fn(), close: vi.fn() };
    ctx.rootCreditBudget = { reserve: vi.fn(), close: vi.fn() };
    ctx.byteLimits = { maxTextRepeatOutputBytes: 10 };
    const result = await node.taskHandler.execute({ text: 'x' }, ctx);
    expect(result.ok).toBe(true);
    expect(runner).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), {
      rootRunId: 'test-run',
      parentRunId: 'test-run',
      depth: 1,
      maxDepth: 3,
      ancestorCompositeNodeTypes: ['bounded'],
    }, { snapshotBudget: ctx.snapshotBudget, rootCreditBudget: ctx.rootCreditBudget, byteLimits: ctx.byteLimits });
  });

  it('passes the exact parent signal and refuses a pre-aborted child launch', async () => {
    const controller = new AbortController();
    const runner = vi.fn(async () => ({ ok: true, outputs: {} }));
    const node = composite('bounded', ['input'], runner);
    const ctx = { ...context('bounded'), signal: controller.signal };
    expect((await node.taskHandler.execute({ text: 'x' }, ctx)).ok).toBe(true);
    expect(runner).toHaveBeenCalledWith(
      expect.any(Object), expect.any(Object), expect.any(Object),
      expect.objectContaining({ signal: controller.signal }),
    );

    controller.abort();
    const cancelled = await node.taskHandler.execute({ text: 'x' }, ctx);
    expect(cancelled).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_CANCELLED', retryable: false },
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'throw'])('parent abort wins a late child %s', async (outcome) => {
    const controller = new AbortController();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const runner = vi.fn(async () => {
      await held;
      if (outcome === 'throw') throw new Error('late child failure');
      return { ok: true, outputs: {} };
    });
    const node = composite('bounded', ['input'], runner);
    const execution = node.taskHandler.execute({ text: 'x' }, {
      ...context('bounded'), signal: controller.signal,
    });
    controller.abort();
    release();
    expect(await execution).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_CANCELLED', retryable: false },
    });
  });

  it('keeps the tightest ancestor depth ceiling', async () => {
    const runner = vi.fn(async () => ({ ok: true, outputs: {} }));
    const node = composite('child', ['input'], runner);
    const result = await node.taskHandler.execute(
      { text: 'x' },
      context('child', {
        rootRunId: 'root',
        parentRunId: 'parent',
        depth: 1,
        maxDepth: 1,
        ancestorCompositeNodeTypes: ['outer'],
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_COMPOSITE_DEPTH_EXCEEDED', retryable: false },
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves a child error with retryable=%s', async (retryable) => {
    const runner = vi.fn(async () => ({
      ok: false,
      outputs: {},
      error: 'child failed',
      errorCode: 'DAG_TASK_EXECUTION_CHILD_FAILURE',
      retryable,
    }));
    const node = composite('parent', ['input'], runner);
    const result = await node.taskHandler.execute({ text: 'x' }, context('parent'));
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_CHILD_FAILURE', retryable },
    });
  });
});
