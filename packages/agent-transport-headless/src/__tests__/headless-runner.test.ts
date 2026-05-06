import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import type { IExecutionResult } from '@robota-sdk/agent-sdk';
import type { TBackgroundJobGroupEvent } from '@robota-sdk/agent-sdk';
import type { TBackgroundTaskEvent } from '@robota-sdk/agent-sdk';
import { createHeadlessRunner } from '../headless-runner.js';

interface IUserSkillCommandTestSession {
  executeUserSkillCommand: ReturnType<typeof vi.fn>;
}

function createMockSession(behavior: 'complete' | 'interrupted' | 'error', response = '') {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    off: vi.fn(),
    submit: vi.fn(async () => {
      if (behavior === 'complete') {
        const result: IExecutionResult = {
          response,
          history: [],
          toolSummaries: [],
          contextState: {} as IExecutionResult['contextState'],
        };
        for (const h of listeners.get('complete') ?? []) {
          h(result);
        }
      } else if (behavior === 'interrupted') {
        const result: IExecutionResult = {
          response,
          history: [],
          toolSummaries: [],
          contextState: {} as IExecutionResult['contextState'],
        };
        for (const h of listeners.get('interrupted') ?? []) {
          h(result);
        }
      } else if (behavior === 'error') {
        for (const h of listeners.get('error') ?? []) {
          h(new Error('test error'));
        }
      }
    }),
    executeCommand: vi.fn().mockResolvedValue(null),
    executeUserSkillCommand: vi.fn().mockResolvedValue(null),
    getSession: vi.fn(() => ({ getSessionId: () => 'test-session-id' })),
  } as unknown as InteractiveSession;
}

describe('createHeadlessRunner (text format)', () => {
  let stdoutWriteSpy: any; // allow-any: vi.spyOn process.stdout.write has incompatible MockInstance generic bounds

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  it('writes response + newline to stdout and returns exit code 0 on complete', async () => {
    const session = createMockSession('complete', 'Hello, world!');
    const runner = createHeadlessRunner({ session, outputFormat: 'text' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(0);
    expect(stdoutWriteSpy).toHaveBeenCalledWith('Hello, world!\n');
  });

  it('writes partial response on interrupted and returns exit code 0', async () => {
    const session = createMockSession('interrupted', 'partial output');
    const runner = createHeadlessRunner({ session, outputFormat: 'text' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(0);
    expect(stdoutWriteSpy).toHaveBeenCalledWith('partial output\n');
  });

  it('does not write to stdout on interrupted with empty response', async () => {
    const session = createMockSession('interrupted', '');
    const runner = createHeadlessRunner({ session, outputFormat: 'text' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(0);
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('returns exit code 1 on error', async () => {
    const session = createMockSession('error');
    const runner = createHeadlessRunner({ session, outputFormat: 'text' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(1);
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('passes the prompt to session.submit', async () => {
    const session = createMockSession('complete', 'ok');
    const runner = createHeadlessRunner({ session, outputFormat: 'text' });

    await runner.run('my prompt');

    expect(session.submit).toHaveBeenCalledWith('my prompt');
  });

  it('executes /agent as a command without submitting to the model', async () => {
    const session = {
      ...createMockSession('complete', 'unused'),
      executeCommand: vi.fn().mockResolvedValue({
        message: 'Started agent job: agent_1',
        success: true,
        data: { agentId: 'agent_1' },
      }),
    } as unknown as InteractiveSession;
    const runner = createHeadlessRunner({ session, outputFormat: 'text' });

    const exitCode = await runner.run('/agent run Plan --background "draft architecture"');

    expect(exitCode).toBe(0);
    expect(session.executeCommand).toHaveBeenCalledWith(
      'agent',
      'run Plan --background "draft architecture"',
    );
    expect(session.submit).not.toHaveBeenCalled();
    expect(stdoutWriteSpy).toHaveBeenCalledWith('Started agent job: agent_1\n');
  });

  it('executes /skill through the session skill API without submitting the raw slash prompt', async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const session = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
      }),
      off: vi.fn(),
      submit: vi.fn(),
      executeCommand: vi.fn().mockResolvedValue(null),
      executeUserSkillCommand: vi.fn().mockImplementation(async () => {
        const result: IExecutionResult = {
          response: 'Skill response',
          history: [],
          toolSummaries: [],
          contextState: {} as IExecutionResult['contextState'],
        };
        for (const handler of listeners.get('complete') ?? []) {
          handler(result);
        }
        return { mode: 'inject', prompt: 'Rendered skill prompt' };
      }),
      getSession: vi.fn(() => ({ getSessionId: () => 'test-session-id' })),
    } as unknown as InteractiveSession;
    const runner = createHeadlessRunner({ session, outputFormat: 'text' });

    const exitCode = await runner.run('/audit src/index.ts');

    expect(exitCode).toBe(0);
    expect(session.executeCommand).toHaveBeenCalledWith('audit', 'src/index.ts');
    expect(
      (session as InteractiveSession & IUserSkillCommandTestSession).executeUserSkillCommand,
    ).toHaveBeenCalledWith('audit', 'src/index.ts', '/audit src/index.ts', '/audit src/index.ts');
    expect(session.submit).not.toHaveBeenCalled();
    expect(stdoutWriteSpy).toHaveBeenCalledWith('Skill response\n');
  });
});

describe('createHeadlessRunner (json format)', () => {
  let stdoutWriteSpy: any; // allow-any: vi.spyOn process.stdout.write has incompatible MockInstance generic bounds

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  it('json format outputs { type, result, session_id, subtype: success }', async () => {
    const session = createMockSession('complete', 'JSON response');
    const runner = createHeadlessRunner({ session, outputFormat: 'json' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(0);
    expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
    const output = (stdoutWriteSpy.mock.calls[0] as [string])[0];
    const parsed: unknown = JSON.parse(output.trim());
    expect(parsed).toEqual({
      type: 'result',
      result: 'JSON response',
      session_id: 'test-session-id',
      subtype: 'success',
    });
  });

  it('json format outputs subtype error on failure', async () => {
    const session = createMockSession('error');
    const runner = createHeadlessRunner({ session, outputFormat: 'json' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(1);
    expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
    const output = (stdoutWriteSpy.mock.calls[0] as [string])[0];
    const parsed: unknown = JSON.parse(output.trim());
    expect(parsed).toEqual({
      type: 'result',
      result: '',
      session_id: 'test-session-id',
      subtype: 'error',
    });
  });

  it('json format outputs subtype success with partial response on interrupted', async () => {
    const session = createMockSession('interrupted', 'partial');
    const runner = createHeadlessRunner({ session, outputFormat: 'json' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(0);
    expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
    const output = (stdoutWriteSpy.mock.calls[0] as [string])[0];
    const parsed: unknown = JSON.parse(output.trim());
    expect(parsed).toEqual({
      type: 'result',
      result: 'partial',
      session_id: 'test-session-id',
      subtype: 'success',
    });
  });
});

describe('createHeadlessRunner (stream-json format)', () => {
  let stdoutWriteSpy: any; // allow-any: vi.spyOn process.stdout.write has incompatible MockInstance generic bounds

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  it('stream-json emits content_block_delta events and final result', async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const session = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
      }),
      off: vi.fn(),
      submit: vi.fn(async () => {
        for (const h of listeners.get('text_delta') ?? []) {
          h('Hello');
          h(' world');
        }
        for (const h of listeners.get('complete') ?? []) {
          h({ response: 'Hello world', history: [], toolSummaries: [], contextState: {} });
        }
      }),
      getSession: vi.fn(() => ({ getSessionId: () => 'stream-session' })),
    } as unknown as InteractiveSession;

    const runner = createHeadlessRunner({ session, outputFormat: 'stream-json' });
    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(0);

    const lines = stdoutWriteSpy.mock.calls.map((call: unknown[]) => (call as [string])[0].trim());
    const parsed: Array<Record<string, unknown>> = lines.map(
      (line: string) => JSON.parse(line) as Record<string, unknown>,
    );

    // 2 stream_event lines + 1 final result line
    expect(parsed).toHaveLength(3);

    // First two are stream events with content_block_delta
    const streamEvents = parsed.filter(
      (p: Record<string, unknown>) => p['type'] === 'stream_event',
    );
    expect(streamEvents).toHaveLength(2);

    for (const evt of streamEvents) {
      expect(evt['session_id']).toBe('stream-session');
      expect(evt['uuid']).toBeDefined();
      const inner = evt['event'] as Record<string, unknown>;
      expect(inner['type']).toBe('content_block_delta');
      const delta = inner['delta'] as Record<string, unknown>;
      expect(delta['type']).toBe('text_delta');
    }

    const firstDelta = (streamEvents[0]!['event'] as Record<string, unknown>)['delta'] as Record<
      string,
      unknown
    >;
    const secondDelta = (streamEvents[1]!['event'] as Record<string, unknown>)['delta'] as Record<
      string,
      unknown
    >;
    expect(firstDelta['text']).toBe('Hello');
    expect(secondDelta['text']).toBe(' world');

    // Final result line
    const resultLine = parsed.find((p: Record<string, unknown>) => p['type'] === 'result');
    expect(resultLine).toEqual({
      type: 'result',
      result: 'Hello world',
      session_id: 'stream-session',
      subtype: 'success',
    });
  });

  it('stream-json emits error result on error', async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const session = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
      }),
      off: vi.fn(),
      submit: vi.fn(async () => {
        for (const h of listeners.get('error') ?? []) {
          h(new Error('stream error'));
        }
      }),
      getSession: vi.fn(() => ({ getSessionId: () => 'stream-session' })),
    } as unknown as InteractiveSession;

    const runner = createHeadlessRunner({ session, outputFormat: 'stream-json' });
    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(1);

    const lines = stdoutWriteSpy.mock.calls.map((call: unknown[]) => (call as [string])[0].trim());
    const parsed: Array<Record<string, unknown>> = lines.map(
      (line: string) => JSON.parse(line) as Record<string, unknown>,
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      type: 'result',
      result: '',
      session_id: 'stream-session',
      subtype: 'error',
    });
  });

  it('stream-json emits background task events before the final result', async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const session = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
      }),
      off: vi.fn(),
      submit: vi.fn(),
      executeCommand: vi.fn().mockImplementation(async () => {
        for (const h of listeners.get('background_task_event') ?? []) {
          h({
            type: 'background_task_created',
            task: {
              id: 'agent_1',
              kind: 'agent',
              label: 'Plan',
              status: 'running',
              mode: 'background',
              parentSessionId: 'stream-session',
              depth: 1,
              cwd: '/workspace',
              updatedAt: '2026-05-01T00:00:00.000Z',
              unread: false,
              promptPreview: 'draft architecture',
            },
          } satisfies TBackgroundTaskEvent);
        }
        return {
          message: 'Started agent job: agent_1',
          success: true,
          data: { agentId: 'agent_1' },
        };
      }),
      getSession: vi.fn(() => ({ getSessionId: () => 'stream-session' })),
    } as unknown as InteractiveSession;

    const runner = createHeadlessRunner({ session, outputFormat: 'stream-json' });
    const exitCode = await runner.run('/agent run Plan --background "draft architecture"');

    expect(exitCode).toBe(0);

    const lines = stdoutWriteSpy.mock.calls.map((call: unknown[]) => (call as [string])[0].trim());
    const parsed: Array<Record<string, unknown>> = lines.map(
      (line: string) => JSON.parse(line) as Record<string, unknown>,
    );

    expect(parsed).toHaveLength(2);
    expect(session.submit).not.toHaveBeenCalled();
    expect(session.executeCommand).toHaveBeenCalledWith(
      'agent',
      'run Plan --background "draft architecture"',
    );
    expect(parsed[0]).toMatchObject({
      type: 'stream_event',
      session_id: 'stream-session',
      event: {
        type: 'background_task_event',
        background_task_event: {
          type: 'background_task_created',
        },
      },
    });
    expect(parsed[1]).toEqual({
      type: 'result',
      result: 'Started agent job: agent_1',
      session_id: 'stream-session',
      subtype: 'success',
    });
  });

  it('stream-json emits background job group events before the final result', async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const session = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
      }),
      off: vi.fn(),
      submit: vi.fn(),
      executeCommand: vi.fn().mockImplementation(async () => {
        for (const h of listeners.get('background_job_group_event') ?? []) {
          h({
            type: 'background_job_group_completed',
            group: {
              id: 'group_1',
              parentSessionId: 'stream-session',
              waitPolicy: 'wait_all',
              taskIds: ['agent_1'],
              status: 'completed',
              createdAt: '2026-05-01T00:00:00.000Z',
              updatedAt: '2026-05-01T00:00:01.000Z',
              completedAt: '2026-05-01T00:00:01.000Z',
              results: [{ taskId: 'agent_1', label: 'Plan', status: 'completed' }],
            },
          } satisfies TBackgroundJobGroupEvent);
        }
        return {
          message: 'Background job group group_1: completed',
          success: true,
          data: { groupId: 'group_1' },
        };
      }),
      getSession: vi.fn(() => ({ getSessionId: () => 'stream-session' })),
    } as unknown as InteractiveSession;

    const runner = createHeadlessRunner({ session, outputFormat: 'stream-json' });
    const exitCode = await runner.run('/agent wait group_1');

    expect(exitCode).toBe(0);

    const lines = stdoutWriteSpy.mock.calls.map((call: unknown[]) => (call as [string])[0].trim());
    const parsed: Array<Record<string, unknown>> = lines.map(
      (line: string) => JSON.parse(line) as Record<string, unknown>,
    );

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      type: 'stream_event',
      session_id: 'stream-session',
      event: {
        type: 'background_job_group_event',
        background_job_group_event: {
          type: 'background_job_group_completed',
        },
      },
    });
    expect(parsed[1]).toEqual({
      type: 'result',
      result: 'Background job group group_1: completed',
      session_id: 'stream-session',
      subtype: 'success',
    });
  });
});
