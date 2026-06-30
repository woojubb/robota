import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileWriteNodeDefinition } from '../index.js';
import type { INodeExecutionContext, TPortPayload } from '@robota-sdk/dag-core';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  mkdir: vi.fn(),
}));

function makeContext(config: Record<string, unknown> = {}): INodeExecutionContext {
  return {
    nodeDefinition: {
      nodeId: 'test-node-id',
      nodeType: 'file-write',
      config,
      inputs: [],
      outputs: [],
    },
    dagRunId: 'test-dag-run-id',
    dagId: 'test-dag-id',
  } as unknown as INodeExecutionContext; // allow-any: minimal test stub
}

describe('FileWriteNodeDefinition', () => {
  const node = new FileWriteNodeDefinition();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TC-01: calls writeFile with correct args on success', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined as never);

    const input: TPortPayload = { text: 'hello', path: 'out.txt' };
    const context = makeContext({ path: '', encoding: 'utf8', append: false, createDirs: true });

    const result = await node.taskHandler.execute(input, context);

    expect(result.ok).toBe(true);
    expect(vi.mocked(writeFile)).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(writeFile).mock.calls[0];
    expect(typeof callArgs[0]).toBe('string'); // resolved path
    expect(callArgs[1]).toBe('hello');
    expect(callArgs[2]).toBe('utf8');
  });

  it('TC-02: calls appendFile when append=true', async () => {
    const { appendFile, mkdir } = await import('node:fs/promises');
    vi.mocked(appendFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined as never);

    const input: TPortPayload = { text: 'more', path: 'out.txt' };
    const context = makeContext({ path: '', encoding: 'utf8', append: true, createDirs: true });

    const result = await node.taskHandler.execute(input, context);

    expect(result.ok).toBe(true);
    expect(vi.mocked(appendFile)).toHaveBeenCalledOnce();
  });

  it('TC-03: calls mkdir with recursive=true when createDirs=true', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined as never);

    const input: TPortPayload = { text: 'data', path: 'nested/dir/out.txt' };
    const context = makeContext({ path: '', encoding: 'utf8', append: false, createDirs: true });

    const result = await node.taskHandler.execute(input, context);

    expect(result.ok).toBe(true);
    expect(vi.mocked(mkdir)).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it('TC-04: fails with DAG_VALIDATION_FILE_WRITE_PATH_REQUIRED when path is empty', async () => {
    const input: TPortPayload = { text: 'hello' };
    const context = makeContext({ path: '', encoding: 'utf8', append: false, createDirs: true });

    const result = await node.taskHandler.execute(input, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_FILE_WRITE_PATH_REQUIRED');
  });
});
