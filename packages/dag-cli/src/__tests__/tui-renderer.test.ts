import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import type { IRuntimeRunProgressEventBusPort } from '@robota-sdk/dag-api';
import type { TRunProgressEvent } from '@robota-sdk/dag-core';
import type { IDagCliIo } from '../types.js';
import { TuiRenderer, isTuiAvailable } from '../progress/tui-renderer.js';

const makeNode = (nodeId: string, dependsOn: string[]) => ({
  nodeId,
  nodeType: 'test',
  dependsOn,
  config: {},
});

const linearDag: IDagDefinition = {
  dagId: 'linear',
  version: 1,
  status: 'draft',
  nodes: [makeNode('A', []), makeNode('B', ['A']), makeNode('C', ['B'])],
  edges: [
    { from: 'A', to: 'B', bindings: [] },
    { from: 'B', to: 'C', bindings: [] },
  ],
};

const fanInDag: IDagDefinition = {
  dagId: 'fanin',
  version: 1,
  status: 'draft',
  nodes: [
    makeNode('inputs', []),
    makeNode('X', ['inputs']),
    makeNode('Y', ['inputs']),
    makeNode('merge', ['X', 'Y']),
    makeNode('out', ['merge']),
  ],
  edges: [
    { from: 'inputs', to: 'X', bindings: [] },
    { from: 'inputs', to: 'Y', bindings: [] },
    { from: 'X', to: 'merge', bindings: [] },
    { from: 'Y', to: 'merge', bindings: [] },
    { from: 'merge', to: 'out', bindings: [] },
  ],
};

function makeMockEventBus(): {
  bus: IRuntimeRunProgressEventBusPort;
  emit: (e: TRunProgressEvent) => void;
} {
  let handler: ((e: TRunProgressEvent) => void) | null = null;
  return {
    bus: {
      publish(e: TRunProgressEvent) {
        handler?.(e);
      },
      subscribe(cb: (e: TRunProgressEvent) => void) {
        handler = cb;
        return () => {
          handler = null;
        };
      },
    },
    emit(e: TRunProgressEvent) {
      handler?.(e);
    },
  };
}

function makeMockIo(): IDagCliIo & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    write(t: string) {
      written.push(t);
    },
    writeError(t: string) {
      written.push(`[err]${t}`);
    },
    async readTextFile(_p: string): Promise<string> {
      return '';
    },
    async writeBinaryStream(_p: string, _s: ReadableStream<Uint8Array>): Promise<void> {},
  };
}

const RUN_ID = 'test-run';
const TASK_ID = 'task-1';
const AT = new Date().toISOString();

const started = (nodeId: string): TRunProgressEvent => ({
  eventType: 'task.started',
  dagRunId: RUN_ID,
  taskRunId: TASK_ID,
  nodeId,
  occurredAt: AT,
});

const completed = (nodeId: string): TRunProgressEvent => ({
  eventType: 'task.completed',
  dagRunId: RUN_ID,
  taskRunId: TASK_ID,
  nodeId,
  occurredAt: AT,
});

const failed = (nodeId: string): TRunProgressEvent => ({
  eventType: 'task.failed',
  dagRunId: RUN_ID,
  taskRunId: TASK_ID,
  nodeId,
  error: {
    code: 'TEST_ERROR',
    category: 'task_execution',
    message: 'test error',
    retryable: false,
  },
  occurredAt: AT,
});

describe('isTuiAvailable', () => {
  it('returns false when not a TTY', () => {
    // In test environment, process.stdout.isTTY is undefined
    expect(isTuiAvailable()).toBe(false);
  });
});

describe('TuiRenderer', () => {
  let stdoutWrite: { mockRestore(): void };
  const written: string[] = [];

  beforeEach(() => {
    written.length = 0;
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  it('writes Running: header on attach', () => {
    const io = makeMockIo();
    const renderer = new TuiRenderer(io, linearDag);
    const { bus } = makeMockEventBus();
    renderer.attach(bus, 'test.dag.json');
    renderer.detach();
    expect(written.some((w) => w.includes('Running: test.dag.json'))).toBe(true);
  });

  it('shows edge line when source node completes (linear)', () => {
    const io = makeMockIo();
    const renderer = new TuiRenderer(io, linearDag);
    const { bus, emit } = makeMockEventBus();

    renderer.attach(bus, 'test.dag.json');
    emit(started('A'));
    emit(completed('A'));
    renderer.detach();

    const all = written.join('');
    // After A completes, should show A ──▶ B edge
    expect(all).toContain('A');
    expect(all).toContain('──▶');
    expect(all).toContain('B');
  });

  it('shows fan-out lines when fan-out source completes', () => {
    const io = makeMockIo();
    const renderer = new TuiRenderer(io, fanInDag);
    const { bus, emit } = makeMockEventBus();

    renderer.attach(bus, 'fanin.dag.json');
    emit(started('inputs'));
    emit(completed('inputs'));
    renderer.detach();

    const all = written.join('');
    // fan-out from inputs → X and Y
    expect(all).toContain('┬──▶');
    expect(all).toContain('└──▶');
  });

  it('shows partial fan-in lines progressively', () => {
    const io = makeMockIo();
    const renderer = new TuiRenderer(io, fanInDag);
    const { bus, emit } = makeMockEventBus();

    renderer.attach(bus, 'fanin.dag.json');

    // Setup: inputs → X and Y start
    emit(started('inputs'));
    emit(completed('inputs'));
    emit(started('X'));
    emit(started('Y'));

    // X completes first — partial fan-in should show X ──┐
    written.length = 0;
    emit(completed('X'));
    const afterX = written.join('');
    // Should show partial fan-in: X ──┐
    expect(afterX).toContain('──┐');

    // Y completes — full fan-in should show Y ──┴──▶ merge
    written.length = 0;
    emit(completed('Y'));
    const afterY = written.join('');
    expect(afterY).toContain('──┴──▶');
    expect(afterY).toContain('merge');

    renderer.detach();
  });

  it('shows [✓] for completed nodes and [✗] for failed nodes', () => {
    const io = makeMockIo();
    const renderer = new TuiRenderer(io, linearDag);
    const { bus, emit } = makeMockEventBus();

    renderer.attach(bus, 'test.dag.json');
    emit(started('A'));
    emit(completed('A'));
    emit(started('B'));
    emit(failed('B'));
    renderer.detach();

    const all = written.join('');
    expect(all).toContain('[✓]');
    expect(all).toContain('[✗]');
  });

  it('detach stops spinner interval', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const io = makeMockIo();
    const renderer = new TuiRenderer(io, linearDag);
    const { bus } = makeMockEventBus();

    renderer.attach(bus, 'test.dag.json');
    renderer.detach();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});
