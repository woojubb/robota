import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileReadNodeDefinition } from '../index.js';
import type { INodeExecutionContext, TPortPayload } from '@robota-sdk/dag-core';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

function makeContext(config: Record<string, unknown> = {}): INodeExecutionContext {
  return {
    nodeDefinition: {
      nodeId: 'test-node-id',
      nodeType: 'file-read',
      config,
      inputs: [],
      outputs: [],
    },
    dagRunId: 'test-dag-run-id',
    dagId: 'test-dag-id',
  } as unknown as INodeExecutionContext; // allow-any: minimal test stub
}

describe('FileReadNodeDefinition', () => {
  const node = new FileReadNodeDefinition();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TC-01: returns ok=true with content on successful read', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue('hello' as never);

    const input: TPortPayload = { path: 'some/file.txt' };
    const context = makeContext({ path: '', encoding: 'utf8' });

    const result = await node.taskHandler.execute(input, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value['text']).toBe('hello');
    expect(typeof result.value['path']).toBe('string');
    expect(typeof result.value['sizeBytes']).toBe('number');
  });

  it('TC-02: fails with FILE_NOT_FOUND errorCode when readFile throws ENOENT', async () => {
    const { readFile } = await import('node:fs/promises');
    const enoentError = Object.assign(new Error('not found'), { code: 'ENOENT' });
    vi.mocked(readFile).mockRejectedValue(enoentError);

    const input: TPortPayload = { path: 'missing/file.txt' };
    const context = makeContext({ path: '', encoding: 'utf8' });

    const result = await node.taskHandler.execute(input, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_TASK_EXECUTION_FILE_READ_FAILED');
    expect(result.error.context?.['errorCode']).toBe('FILE_NOT_FOUND');
  });

  it('TC-03: fails with DAG_VALIDATION_FILE_READ_PATH_REQUIRED when path is empty', async () => {
    const input: TPortPayload = {};
    const context = makeContext({ path: '', encoding: 'utf8' });

    const result = await node.taskHandler.execute(input, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_FILE_READ_PATH_REQUIRED');
  });
});
