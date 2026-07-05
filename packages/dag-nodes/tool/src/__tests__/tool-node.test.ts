import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INodeExecutionContext, INodeConfigObject, TPortPayload } from '@robota-sdk/dag-core';
import {
  ToolNodeDefinition,
  ToolNodeConfigSchema,
  TOOL_NODE_ALLOWED_TOOLS,
  createToolNodeDefinition,
} from '../index.js';

function makeContext(config: Record<string, unknown>): INodeExecutionContext {
  const node = new ToolNodeDefinition();
  return {
    dagId: 'dag-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeDefinition: {
      nodeId: 'tool-1',
      nodeType: 'tool',
      dependsOn: [],
      config: config as INodeConfigObject,
      inputs: [],
      outputs: [],
    },
    nodeManifest: {
      nodeType: 'tool',
      displayName: 'Tool',
      category: 'Integration',
      inputs: node.inputs,
      outputs: node.outputs,
      defaultInputPort: node.defaultInputPort,
      defaultOutputPort: node.defaultOutputPort,
    },
    attempt: 1,
    executionPath: [],
    currentTotalCredits: 0,
  };
}

describe('ToolNodeDefinition metadata', () => {
  it('has correct nodeType and displayName', () => {
    const node = new ToolNodeDefinition();
    expect(node.nodeType).toBe('tool');
    expect(node.displayName).toBe('Tool');
    expect(node.category).toBe('Integration');
  });

  it('has correct port definitions', () => {
    const node = new ToolNodeDefinition();
    expect(node.inputs.find((p) => p.key === 'params')).toBeDefined();
    expect(node.outputs.find((p) => p.key === 'output')).toBeDefined();
    expect(node.outputs.find((p) => p.key === 'isError')).toBeDefined();
    expect(node.defaultInputPort).toBe('params');
    expect(node.defaultOutputPort).toBe('output');
  });

  it('factory returns an instance', () => {
    expect(createToolNodeDefinition()).toBeInstanceOf(ToolNodeDefinition);
  });

  it('exposes the allowed-tools allowlist', () => {
    expect(TOOL_NODE_ALLOWED_TOOLS).toContain('read');
    expect(TOOL_NODE_ALLOWED_TOOLS).toContain('grep');
    expect(TOOL_NODE_ALLOWED_TOOLS).toContain('shell');
  });
});

describe('ToolNodeConfigSchema', () => {
  it('accepts minimal config and applies defaults', () => {
    const result = ToolNodeConfigSchema.safeParse({ toolName: 'grep' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.params).toEqual({});
    expect(result.data.baseCredits).toBe(0);
  });

  it('rejects empty toolName', () => {
    expect(ToolNodeConfigSchema.safeParse({ toolName: '' }).success).toBe(false);
  });

  it('rejects negative baseCredits', () => {
    expect(ToolNodeConfigSchema.safeParse({ toolName: 'read', baseCredits: -1 }).success).toBe(
      false,
    );
  });
});

describe('ToolNodeDefinition execution', () => {
  const node = new ToolNodeDefinition();
  let dir: string;
  let file: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dag-tool-node-'));
    file = join(dir, 'hello.txt');
    writeFileSync(file, 'alpha\nbeta\ngamma\n', 'utf8');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(config: Record<string, unknown>, input: TPortPayload = {}) {
    return node.taskHandler.execute(input, makeContext(config));
  }

  it('rejects an unknown toolName with a set_config validation error', async () => {
    const result = await run({ toolName: 'does-not-exist' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_TOOL_UNKNOWN_TOOL');
    expect(result.error.fix?.action).toBe('set_config');
    expect(Array.isArray(result.error.fix?.options)).toBe(true);
  });

  it('rejects invalid JSON in the params input port', async () => {
    const result = await run({ toolName: 'read' }, { params: 'not json{' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_TOOL_INVALID_PARAMS');
  });

  it('reads a file via the in-process read builtin (config params)', async () => {
    const result = await run({ toolName: 'read', params: { filePath: file } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.output).toContain('alpha');
    expect(result.value.output).toContain('gamma');
    expect(result.value.isError).toBe(false);
  });

  it('merges the params input port over config params (input wins)', async () => {
    const other = join(dir, 'other.txt');
    writeFileSync(other, 'from-input-file\n', 'utf8');
    const result = await run(
      { toolName: 'read', params: { filePath: file } },
      { params: JSON.stringify({ filePath: other }) },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.output).toContain('from-input-file');
  });

  it('surfaces a soft tool failure as isError=true (missing file)', async () => {
    const result = await run({ toolName: 'read', params: { filePath: join(dir, 'nope.txt') } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isError).toBe(true);
  });
});
