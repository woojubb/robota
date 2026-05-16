import { describe, expect, it, vi } from 'vitest';
import type { IToolResult } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskManager,
  TBackgroundTaskRequest,
  IBackgroundTaskState,
} from '../../background-tasks/index.js';
import { createBackgroundProcessTool } from '../background-process-tool.js';

function parseToolResult(toolResult: IToolResult): Record<string, unknown> {
  return JSON.parse(toolResult.data as string);
}

function makeTaskState(request: TBackgroundTaskRequest): IBackgroundTaskState {
  return {
    id: 'process_1',
    kind: 'process',
    label: request.label,
    status: 'running',
    mode: request.mode,
    parentSessionId: request.parentSessionId,
    depth: request.depth,
    cwd: request.cwd,
    updatedAt: '2026-04-30T00:00:00.000Z',
    ...(request.kind === 'process' ? { commandPreview: request.command } : {}),
    unread: false,
  };
}

function makeManager(spawn = vi.fn()): IBackgroundTaskManager {
  return {
    spawn,
    wait: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
    readLog: vi.fn(),
    shutdown: vi.fn(),
    subscribe: vi.fn(),
  };
}

describe('BackgroundProcess tool', () => {
  it('spawns a managed process task and returns metadata immediately', async () => {
    const spawn = vi.fn(async (request: TBackgroundTaskRequest) => makeTaskState(request));
    const manager = makeManager(spawn);
    const tool = createBackgroundProcessTool({
      backgroundTaskManager: manager,
      cwd: '/workspace',
      parentSessionId: 'session_1',
    });

    const result = parseToolResult(
      await tool.execute({
        command: 'pnpm test',
        timeout: 5000,
        workingDirectory: '/workspace/pkg',
        stdin: 'input\n',
        outputLimitBytes: 1024,
      }),
    );

    expect(spawn).toHaveBeenCalledWith({
      kind: 'process',
      label: 'pnpm test',
      mode: 'background',
      parentSessionId: 'session_1',
      depth: 0,
      cwd: '/workspace/pkg',
      command: 'pnpm test',
      stdin: 'input\n',
      timeoutMs: 5000,
      outputLimitBytes: 1024,
    });
    expect(result).toMatchObject({
      success: true,
      background: true,
      output: '',
      taskId: 'process_1',
      status: 'running',
      command: 'pnpm test',
    });
  });

  it('returns a structured error when the process runner is unavailable', async () => {
    const manager = makeManager(vi.fn(async () => Promise.reject(new Error('no process runner'))));
    const tool = createBackgroundProcessTool({ backgroundTaskManager: manager });

    const result = parseToolResult(await tool.execute({ command: 'long command' }));

    expect(result['success']).toBe(false);
    expect(result['background']).toBe(true);
    expect(result['error']).toBe('Background process error: no process runner');
  });
});
