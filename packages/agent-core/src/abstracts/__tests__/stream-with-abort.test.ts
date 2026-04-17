/**
 * Tests for BaseAIProvider.streamWithAbort() — the standard streaming wrapper.
 */

import { describe, it, expect } from 'vitest';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IChatOptions } from '../../interfaces/provider';
import { AbstractAIProvider } from '../abstract-ai-provider';

// Minimal concrete provider for testing
class TestProvider extends AbstractAIProvider {
  name = 'test';
  version = '1.0.0';

  async chat(): Promise<TUniversalMessage> {
    return {
      id: '1',
      role: 'assistant',
      content: 'test',
      state: 'complete',
      timestamp: new Date(),
    };
  }

  // Expose protected method for testing
  async *testStreamWithAbort<T>(source: AsyncIterable<T>, signal?: AbortSignal): AsyncGenerator<T> {
    yield* this.streamWithAbort(source, signal);
  }
}

// Helper: create async iterable from array
async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

describe('BaseAIProvider.streamWithAbort', () => {
  const provider = new TestProvider();

  it('yields all items when no abort', async () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const result: string[] = [];
    for await (const item of provider.testStreamWithAbort(fromArray(items))) {
      result.push(item);
    }
    expect(result).toEqual(items);
  });

  it('stops yielding when signal is aborted', async () => {
    const controller = new AbortController();
    const items = ['a', 'b', 'c', 'd', 'e'];
    const result: string[] = [];

    for await (const item of provider.testStreamWithAbort(fromArray(items), controller.signal)) {
      result.push(item);
      if (result.length === 2) controller.abort();
    }

    // Should stop — abort fires, next setImmediate cycle checks it
    expect(result.length).toBeLessThan(5);
    expect(result).toContain('a');
    expect(result).toContain('b');
  });

  it('stops immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const items = ['a', 'b', 'c'];
    const result: string[] = [];

    for await (const item of provider.testStreamWithAbort(fromArray(items), controller.signal)) {
      result.push(item);
    }

    expect(result).toHaveLength(0);
  });

  it('yields to macrotask queue periodically (allows abort between events)', async () => {
    const controller = new AbortController();
    const items = Array.from({ length: 100 }, (_, i) => `item${i}`);
    const result: string[] = [];

    // Abort after 10ms — setTimeout(0) per event ~1ms, so ~10 events before abort
    setTimeout(() => controller.abort(), 10);

    for await (const item of provider.testStreamWithAbort(fromArray(items), controller.signal)) {
      result.push(item);
    }

    // Should have stopped before all 100 items
    expect(result.length).toBeLessThan(100);
    expect(result.length).toBeGreaterThan(0);
  });
});
