import { describe, it, expect, vi } from 'vitest';
import { RunProgressRenderer } from '../progress/run-progress-renderer.js';
import type { IDagCliIo } from '../types.js';
import type { IRuntimeRunProgressEventBusPort } from '@robota-sdk/dag-api';
import type { TRunProgressEvent } from '@robota-sdk/dag-core';

function makeIo(): { io: IDagCliIo; lines: string[] } {
  const lines: string[] = [];
  const io: IDagCliIo = {
    write: (t) => {
      lines.push(t);
    },
    writeError: vi.fn(),
    readTextFile: vi.fn(),
    writeBinaryStream: vi.fn(),
  };
  return { io, lines };
}

function makeBus(): {
  bus: IRuntimeRunProgressEventBusPort;
  emit: (event: TRunProgressEvent) => void;
} {
  let listener: ((e: TRunProgressEvent) => void) | null = null;
  const bus: IRuntimeRunProgressEventBusPort = {
    publish: (e) => listener?.(e),
    subscribe: (fn) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  };
  return { bus, emit: (e) => bus.publish(e) };
}

const BASE_EVENT = {
  dagRunId: 'run-1',
  occurredAt: new Date().toISOString(),
};

describe('RunProgressRenderer', () => {
  it('writes header on attach', () => {
    const { io, lines } = makeIo();
    const { bus } = makeBus();
    const renderer = new RunProgressRenderer(io);
    renderer.attach(bus, 'workflow.dag.json');
    expect(lines[0]).toContain('Running: workflow.dag.json');
  });

  it('writes task.started event', () => {
    const { io, lines } = makeIo();
    const { bus, emit } = makeBus();
    const renderer = new RunProgressRenderer(io);
    renderer.attach(bus, 'test.dag.json');
    emit({ ...BASE_EVENT, eventType: 'task.started', taskRunId: 't1', nodeId: 'llm-1' });
    expect(lines.some((l) => l.includes('llm-1'))).toBe(true);
  });

  it('writes task.completed with duration', () => {
    const { io, lines } = makeIo();
    const { bus, emit } = makeBus();
    const renderer = new RunProgressRenderer(io);
    renderer.attach(bus, 'test.dag.json');
    emit({ ...BASE_EVENT, eventType: 'task.started', taskRunId: 't1', nodeId: 'llm-1' });
    emit({ ...BASE_EVENT, eventType: 'task.completed', taskRunId: 't1', nodeId: 'llm-1' });
    const completedLine = lines.find((l) => l.includes('✓') && l.includes('llm-1'));
    expect(completedLine).toBeDefined();
    expect(completedLine).toMatch(/\[\d+ms\]/);
  });

  it('writes task.failed with error message', () => {
    const { io, lines } = makeIo();
    const { bus, emit } = makeBus();
    const renderer = new RunProgressRenderer(io);
    renderer.attach(bus, 'test.dag.json');
    emit({
      ...BASE_EVENT,
      eventType: 'task.failed',
      taskRunId: 't1',
      nodeId: 'llm-1',
      error: { code: 'ERR', message: 'API key missing', category: 'validation', retryable: false },
    });
    const failLine = lines.find((l) => l.includes('✗') && l.includes('llm-1'));
    expect(failLine).toBeDefined();
    expect(failLine).toContain('API key missing');
  });

  it('writes separator on execution.completed', () => {
    const { io, lines } = makeIo();
    const { bus, emit } = makeBus();
    const renderer = new RunProgressRenderer(io);
    renderer.attach(bus, 'test.dag.json');
    emit({ ...BASE_EVENT, eventType: 'execution.completed' });
    expect(lines.some((l) => l.includes('─'))).toBe(true);
  });

  it('detach stops receiving events', () => {
    const { io, lines } = makeIo();
    const { bus, emit } = makeBus();
    const renderer = new RunProgressRenderer(io);
    renderer.attach(bus, 'test.dag.json');
    renderer.detach();
    const countBefore = lines.length;
    emit({ ...BASE_EVENT, eventType: 'task.started', taskRunId: 't1', nodeId: 'llm-1' });
    expect(lines.length).toBe(countBefore);
  });

  it('writes task.completed when no prior task.started (covers ??: map miss branch)', () => {
    // task.completed without task.started means nodeStartedAt.get() returns undefined
    // so the ?? fallback (Date.now()) is used
    const { io, lines } = makeIo();
    const { bus, emit } = makeBus();
    const renderer = new RunProgressRenderer(io);
    renderer.attach(bus, 'test.dag.json');
    // emit task.completed WITHOUT task.started — triggers ?? fallback
    emit({ ...BASE_EVENT, eventType: 'task.completed', taskRunId: 't1', nodeId: 'llm-1' });
    const completedLine = lines.find((l) => l.includes('✓') && l.includes('llm-1'));
    expect(completedLine).toBeDefined();
  });

  it('writes task.failed with error.code when message is undefined (covers ?? branch)', () => {
    // error.message is undefined so `?? event.error.code` fallback is used
    const { io, lines } = makeIo();
    const { bus, emit } = makeBus();
    const renderer = new RunProgressRenderer(io);
    renderer.attach(bus, 'test.dag.json');
    emit({
      ...BASE_EVENT,
      eventType: 'task.failed',
      taskRunId: 't1',
      nodeId: 'llm-1',
      error: {
        code: 'TIMEOUT_ERROR',
        message: undefined as unknown as string,
        category: 'task_execution',
        retryable: false,
      },
    });
    const failLine = lines.find((l) => l.includes('✗') && l.includes('llm-1'));
    expect(failLine).toBeDefined();
    expect(failLine).toContain('TIMEOUT_ERROR');
  });

  it('writes execution.failed event with error info', () => {
    const { io, lines } = makeIo();
    const { bus, emit } = makeBus();
    const renderer = new RunProgressRenderer(io);
    renderer.attach(bus, 'test.dag.json');
    emit({
      ...BASE_EVENT,
      eventType: 'execution.failed',
      error: {
        code: 'EXEC_FAIL',
        message: 'Execution failed',
        category: 'task_execution',
        retryable: false,
      },
    });
    expect(lines.some((l) => l.includes('─'))).toBe(true);
    expect(lines.some((l) => l.includes('Run failed'))).toBe(true);
  });

  it('writes execution.failed with error.code when message is undefined (covers ?? branch in execution.failed)', () => {
    // error.message is undefined so `?? event.error.code` fallback is used in execution.failed
    const { io, lines } = makeIo();
    const { bus, emit } = makeBus();
    const renderer = new RunProgressRenderer(io);
    renderer.attach(bus, 'test.dag.json');
    emit({
      ...BASE_EVENT,
      eventType: 'execution.failed',
      error: {
        code: 'TIMEOUT_EXEC',
        message: undefined as unknown as string,
        category: 'task_execution',
        retryable: false,
      },
    });
    expect(lines.some((l) => l.includes('Run failed'))).toBe(true);
    expect(lines.some((l) => l.includes('TIMEOUT_EXEC'))).toBe(true);
  });
});
