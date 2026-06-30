import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineDagNode } from '../lifecycle/define-dag-node.js';
import type { INodeExecutionContext, INodeConfigObject } from '@robota-sdk/dag-core';

function makeContext(nodeType: string, config: INodeConfigObject = {}): INodeExecutionContext {
  return {
    dagId: 'test-dag',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    attempt: 1,
    executionPath: [],
    currentTotalCredits: 0,
    nodeDefinition: {
      nodeId: 'node-1',
      nodeType,
      dependsOn: [],
      config,
    },
    nodeManifest: {
      nodeType,
      displayName: nodeType,
      category: 'Custom',
      inputs: [],
      outputs: [],
    },
  };
}

describe('defineDagNode', () => {
  describe('basic node creation', () => {
    it('returns a constructor that produces an IDagNodeDefinition', () => {
      const UpperCase = defineDagNode({
        nodeType: 'upper-case',
        inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        execute: async ({ text }) => ({ text: String(text).toUpperCase() }),
      });

      const node = new UpperCase();
      expect(node.nodeType).toBe('upper-case');
      expect(node.displayName).toBe('upper-case'); // defaults to nodeType
      expect(node.category).toBe('Custom');
    });

    it('uses displayName when provided', () => {
      const Node = defineDagNode({
        nodeType: 'upper-case',
        displayName: 'Uppercase Text',
        inputs: [],
        outputs: [],
        execute: async () => ({}),
      });
      expect(new Node().displayName).toBe('Uppercase Text');
    });

    it('uses category when provided', () => {
      const Node = defineDagNode({
        nodeType: 'my-node',
        category: 'Text Processing',
        inputs: [],
        outputs: [],
        execute: async () => ({}),
      });
      expect(new Node().category).toBe('Text Processing');
    });

    it('defaults defaultInputPort to first input key', () => {
      const Node = defineDagNode({
        nodeType: 'my-node',
        inputs: [{ key: 'source', label: 'Source', order: 0, type: 'string', required: true }],
        outputs: [],
        execute: async () => ({}),
      });
      expect(new Node().defaultInputPort).toBe('source');
    });

    it('defaults defaultOutputPort to first output key', () => {
      const Node = defineDagNode({
        nodeType: 'my-node',
        inputs: [],
        outputs: [{ key: 'result', label: 'Result', order: 0, type: 'string', required: true }],
        execute: async () => ({}),
      });
      expect(new Node().defaultOutputPort).toBe('result');
    });

    it('respects explicit defaultInputPort and defaultOutputPort', () => {
      const Node = defineDagNode({
        nodeType: 'my-node',
        defaultInputPort: 'data',
        defaultOutputPort: 'output',
        inputs: [
          { key: 'text', label: 'Text', order: 0, type: 'string', required: false },
          { key: 'data', label: 'Data', order: 1, type: 'object', required: false },
        ],
        outputs: [
          { key: 'text', label: 'Text', order: 0, type: 'string', required: false },
          { key: 'output', label: 'Output', order: 1, type: 'object', required: false },
        ],
        execute: async () => ({}),
      });
      expect(new Node().defaultInputPort).toBe('data');
      expect(new Node().defaultOutputPort).toBe('output');
    });

    it('taskHandler is defined on the instance', () => {
      const Node = defineDagNode({
        nodeType: 'my-node',
        inputs: [],
        outputs: [],
        execute: async () => ({}),
      });
      expect(new Node().taskHandler).toBeDefined();
    });
  });

  describe('execute via taskHandler', () => {
    it('passes inputs to execute and returns output', async () => {
      const Node = defineDagNode({
        nodeType: 'upper-case',
        inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        execute: async ({ text }) => ({ text: String(text).toUpperCase() }),
      });

      const node = new Node();
      const ctx = makeContext('upper-case');
      const result = await node.taskHandler.execute({ text: 'hello' }, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('HELLO');
      }
    });

    it('auto-generates _agentSummary from first output when not provided', async () => {
      const Node = defineDagNode({
        nodeType: 'upper-case',
        displayName: 'Uppercase',
        inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        execute: async ({ text }) => ({ text: String(text).toUpperCase() }),
      });

      const node = new Node();
      const result = await node.taskHandler.execute({ text: 'hello' }, makeContext('upper-case'));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.value._agentSummary).toBe('string');
        expect(result.value._agentSummary).toContain('HELLO');
      }
    });

    it('does not override _agentSummary when execute returns it', async () => {
      const Node = defineDagNode({
        nodeType: 'my-node',
        inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        execute: async ({ text }) => ({
          text: String(text),
          _agentSummary: 'custom summary',
        }),
      });

      const result = await new Node().taskHandler.execute({ text: 'hi' }, makeContext('my-node'));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value._agentSummary).toBe('custom summary');
      }
    });

    it('converts thrown errors to IDagError result', async () => {
      const Node = defineDagNode({
        nodeType: 'failing-node',
        inputs: [],
        outputs: [],
        execute: async () => {
          throw new Error('something went wrong');
        },
      });

      const result = await new Node().taskHandler.execute({}, makeContext('failing-node'));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('something went wrong');
      }
    });
  });

  describe('config schema', () => {
    it('parses config using the provided Zod schema', async () => {
      const ConfigSchema = z.object({ prefix: z.string().default('>>') });

      const Node = defineDagNode({
        nodeType: 'prefixed',
        configSchema: ConfigSchema,
        inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        execute: async ({ text }, config) => ({ text: `${config.prefix} ${String(text)}` }),
      });

      const ctx = makeContext('prefixed', { prefix: '---' });
      const result = await new Node().taskHandler.execute({ text: 'hello' }, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('--- hello');
      }
    });

    it('applies schema defaults when config key is missing', async () => {
      const ConfigSchema = z.object({ prefix: z.string().default('>>') });

      const Node = defineDagNode({
        nodeType: 'prefixed',
        configSchema: ConfigSchema,
        inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        execute: async ({ text }, config) => ({ text: `${config.prefix} ${String(text)}` }),
      });

      const ctx = makeContext('prefixed', {}); // no prefix in config
      const result = await new Node().taskHandler.execute({ text: 'world' }, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('>> world');
      }
    });

    it('returns validation error when config fails schema', async () => {
      const ConfigSchema = z.object({ count: z.number() });

      const Node = defineDagNode({
        nodeType: 'counted',
        configSchema: ConfigSchema,
        inputs: [],
        outputs: [],
        execute: async () => ({}),
      });

      const ctx = makeContext('counted', { count: 'not-a-number' as unknown as number });
      const result = await new Node().taskHandler.execute({}, ctx);

      expect(result.ok).toBe(false);
    });

    it('works without configSchema (empty config)', async () => {
      const Node = defineDagNode({
        nodeType: 'no-config',
        inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        execute: async ({ text }) => ({ text: String(text) }),
      });

      const result = await new Node().taskHandler.execute({ text: 'hi' }, makeContext('no-config'));
      expect(result.ok).toBe(true);
    });
  });

  describe('estimateCost', () => {
    it('returns 0 credits when estimateCreditCost is not provided', async () => {
      const Node = defineDagNode({
        nodeType: 'free-node',
        inputs: [],
        outputs: [],
        execute: async () => ({}),
      });

      const { estimateCost } = new Node().taskHandler;
      expect(estimateCost).toBeDefined();
      const result = await estimateCost!({}, makeContext('free-node'));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.estimatedCredits).toBe(0);
      }
    });

    it('delegates to estimateCreditCost when provided', async () => {
      const Node = defineDagNode({
        nodeType: 'costly-node',
        inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        outputs: [],
        estimateCreditCost: async ({ text }) => String(text).length * 0.01,
        execute: async () => ({}),
      });

      const { estimateCost } = new Node().taskHandler;
      expect(estimateCost).toBeDefined();
      const result = await estimateCost!({ text: 'hello' }, makeContext('costly-node'));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.estimatedCredits).toBeCloseTo(0.05);
      }
    });
  });

  describe('multiple instances are independent', () => {
    it('two instances of the same defineDagNode class share no state', async () => {
      const Node = defineDagNode({
        nodeType: 'stateless',
        inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
        execute: async ({ text }) => ({ text: String(text).toUpperCase() }),
      });

      const a = new Node();
      const b = new Node();

      const [ra, rb] = await Promise.all([
        a.taskHandler.execute({ text: 'alpha' }, makeContext('stateless')),
        b.taskHandler.execute({ text: 'beta' }, makeContext('stateless')),
      ]);

      expect(ra.ok && ra.value.text).toBe('ALPHA');
      expect(rb.ok && rb.value.text).toBe('BETA');
    });
  });
});
