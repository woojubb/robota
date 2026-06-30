import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteQueueAdapter } from '../sqlite-queue-adapter.js';
import type { IQueueMessage } from '@robota-sdk/dag-core';

function makeMessage(overrides: Partial<IQueueMessage> = {}): IQueueMessage {
  return {
    messageId: 'msg-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeId: 'node-1',
    attempt: 0,
    executionPath: [],
    payload: { text: 'hello' },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('SqliteQueueAdapter', () => {
  let adapter: SqliteQueueAdapter;

  beforeEach(() => {
    adapter = new SqliteQueueAdapter(':memory:');
  });

  afterEach(() => {
    adapter.close();
  });

  it('enqueue and dequeue returns the message', async () => {
    await adapter.enqueue(makeMessage());
    const msg = await adapter.dequeue('worker-1', 5000);
    expect(msg?.messageId).toBe('msg-1');
    expect(msg?.payload).toEqual({ text: 'hello' });
  });

  it('dequeue returns undefined when queue is empty', async () => {
    const msg = await adapter.dequeue('worker-1', 5000);
    expect(msg).toBeUndefined();
  });

  it('ack removes the message', async () => {
    await adapter.enqueue(makeMessage());
    const msg = await adapter.dequeue('worker-1', 5000);
    expect(msg).toBeDefined();
    await adapter.ack(msg!.messageId);
    const again = await adapter.dequeue('worker-1', 5000);
    expect(again).toBeUndefined();
  });

  it('nack returns the message to the front of the queue', async () => {
    await adapter.enqueue(makeMessage());
    const msg = await adapter.dequeue('worker-1', 5000);
    expect(msg).toBeDefined();
    await adapter.nack(msg!.messageId);
    const requeued = await adapter.dequeue('worker-1', 5000);
    expect(requeued?.messageId).toBe('msg-1');
  });

  it('in-flight message is not dequeued by a second worker', async () => {
    await adapter.enqueue(makeMessage());
    const first = await adapter.dequeue('worker-1', 60000);
    expect(first).toBeDefined();
    const second = await adapter.dequeue('worker-2', 60000);
    expect(second).toBeUndefined();
  });

  it('preserves executionPath across round-trip', async () => {
    const path = ['dag-1', 'run-1', 'node-1'];
    await adapter.enqueue(makeMessage({ executionPath: path }));
    const msg = await adapter.dequeue('worker-1', 5000);
    expect(msg?.executionPath).toEqual(path);
  });
});
