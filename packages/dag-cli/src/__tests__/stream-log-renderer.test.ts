import { describe, it, expect, vi } from 'vitest';
import { StreamLogRenderer } from '../progress/stream-log-renderer.js';
import type { IDagCliIo } from '../types.js';
import type { IRuntimeRunProgressEventBusPort } from '@robota-sdk/dag-api';

function makeIo(): IDagCliIo & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write: vi.fn((s: string) => {
      lines.push(s);
    }),
    writeError: vi.fn(),
    readTextFile: vi.fn(),
    writeBinaryStream: vi.fn().mockResolvedValue(undefined),
  };
}

function makeEventBus(): IRuntimeRunProgressEventBusPort & { emit: (event: unknown) => void } {
  let handler: ((e: unknown) => void) | null = null;
  return {
    subscribe: vi.fn((cb: (e: unknown) => void) => {
      handler = cb;
      return () => {
        handler = null;
      };
    }),
    publish: vi.fn(),
    emit: (event: unknown) => {
      handler?.(event);
    },
  } as unknown as IRuntimeRunProgressEventBusPort & { emit: (event: unknown) => void };
}

describe('StreamLogRenderer', () => {
  it('writes a running line on task.started', () => {
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new StreamLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');

    bus.emit({ eventType: 'task.started', nodeId: 'node-a' });

    const combined = io.lines.join('');
    expect(combined).toContain('node-a');
    expect(combined).toContain('running');
  });

  it('writes success line with preview on task.completed', () => {
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new StreamLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');

    bus.emit({
      eventType: 'task.completed',
      nodeId: 'node-a',
      output: { text: 'hello world' },
    });

    const combined = io.lines.join('');
    expect(combined).toContain('node-a');
    expect(combined).toContain('hello world');
  });

  it('writes success line without preview when output has no keys', () => {
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new StreamLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');

    bus.emit({ eventType: 'task.completed', nodeId: 'node-b', output: {} });

    const combined = io.lines.join('');
    expect(combined).toContain('node-b');
    expect(combined).not.toContain('→');
  });

  it('truncates long preview values', () => {
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new StreamLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');

    const longText = 'a'.repeat(100);
    bus.emit({ eventType: 'task.completed', nodeId: 'n', output: { text: longText } });

    const combined = io.lines.join('');
    expect(combined).toContain('...');
  });

  it('writes failure line on task.failed', () => {
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new StreamLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');

    bus.emit({
      eventType: 'task.failed',
      nodeId: 'node-c',
      error: { message: 'timeout', code: 'TIMEOUT' },
    });

    const combined = io.lines.join('');
    expect(combined).toContain('node-c');
    expect(combined).toContain('timeout');
  });

  it('writes execution.failed line', () => {
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new StreamLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');

    bus.emit({
      eventType: 'execution.failed',
      error: { message: 'DAG failed', code: 'EXEC_FAILED' },
    });

    const combined = io.lines.join('');
    expect(combined).toContain('execution failed');
    expect(combined).toContain('DAG failed');
  });

  it('uses error.code when error.message is absent', () => {
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new StreamLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');

    bus.emit({
      eventType: 'task.failed',
      nodeId: 'x',
      error: { message: undefined, code: 'MY_CODE' },
    });

    const combined = io.lines.join('');
    expect(combined).toContain('MY_CODE');
  });

  it('handles non-string output value (JSON.stringify preview)', () => {
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new StreamLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');

    bus.emit({
      eventType: 'task.completed',
      nodeId: 'n',
      output: { count: 42 },
    });

    const combined = io.lines.join('');
    expect(combined).toContain('42');
  });

  it('writes completed message on onComplete', () => {
    const io = makeIo();
    const renderer = new StreamLogRenderer(io);

    renderer.onComplete(2500);

    const combined = io.lines.join('');
    expect(combined).toContain('Completed');
    expect(combined).toContain('2.5s');
  });

  it('detach stops receiving events', () => {
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new StreamLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');
    renderer.detach();

    const linesBefore = io.lines.length;
    bus.emit({ eventType: 'task.started', nodeId: 'n' });
    expect(io.lines.length).toBe(linesBefore);
  });

  it('detach is safe to call multiple times', () => {
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new StreamLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');
    renderer.detach();
    expect(() => renderer.detach()).not.toThrow();
  });

  it('ignores unrecognized event types', () => {
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new StreamLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');

    const linesBefore = io.lines.length;
    bus.emit({ eventType: 'unknown.event', nodeId: 'n' });
    expect(io.lines.length).toBe(linesBefore);
  });
});

describe('PlainLogRenderer', () => {
  it('logs task.started and task.completed events', async () => {
    const { PlainLogRenderer } = await import('../progress/plain-log-renderer.js');
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new PlainLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');

    bus.emit({ eventType: 'task.started', nodeId: 'node-a' });
    bus.emit({ eventType: 'task.completed', nodeId: 'node-a', output: { text: 'hi' } });

    const combined = io.lines.join('');
    expect(combined).toContain('node-a');
    expect(combined).toContain('status=running');
    expect(combined).toContain('status=success');
  });

  it('logs task.failed event', async () => {
    const { PlainLogRenderer } = await import('../progress/plain-log-renderer.js');
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new PlainLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');

    bus.emit({
      eventType: 'task.failed',
      nodeId: 'node-b',
      error: { message: 'oops', code: 'ERR' },
    });

    const combined = io.lines.join('');
    expect(combined).toContain('status=failed');
    expect(combined).toContain('oops');
  });

  it('logs execution.completed event', async () => {
    const { PlainLogRenderer } = await import('../progress/plain-log-renderer.js');
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new PlainLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');

    bus.emit({ eventType: 'execution.completed' });

    const combined = io.lines.join('');
    expect(combined).toContain('dag-run completed status=success');
  });

  it('logs execution.failed event', async () => {
    const { PlainLogRenderer } = await import('../progress/plain-log-renderer.js');
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new PlainLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');

    bus.emit({
      eventType: 'execution.failed',
      error: { message: 'boom', code: 'BOOM' },
    });

    const combined = io.lines.join('');
    expect(combined).toContain('dag-run completed status=failed');
    expect(combined).toContain('boom');
  });

  it('detach stops event handling', async () => {
    const { PlainLogRenderer } = await import('../progress/plain-log-renderer.js');
    const io = makeIo();
    const bus = makeEventBus();
    const renderer = new PlainLogRenderer(io);
    renderer.attach(bus, 'test.dag.json');
    renderer.detach();

    const linesBefore = io.lines.length;
    bus.emit({ eventType: 'task.started', nodeId: 'n' });
    expect(io.lines.length).toBe(linesBefore);
  });
});
