import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpPendingCalls } from '../mcp-pending-calls.js';

import type { IMcpParkedCall } from '../mcp-pending-calls.js';

afterEach(() => {
  vi.useRealTimers();
});

function parkedCall(): IMcpParkedCall & { settleOutstanding: ReturnType<typeof vi.fn> } {
  const settleOutstanding = vi.fn();
  return {
    prompts: { settleOutstanding } as unknown as IMcpParkedCall['prompts'],
    prompt: { kind: 'permission', event: { id: 'p1', toolName: 'Write', toolArgs: {} } },
    outcome: new Promise(() => undefined),
    abort: new AbortController(),
    settleOutstanding,
  };
}

describe('parked calls', () => {
  it('abandons a call whose client does not come back in time', () => {
    vi.useFakeTimers();
    const pending = new McpPendingCalls(1000);
    const call = parkedCall();
    const token = pending.park(call)!;

    vi.advanceTimersByTime(999);
    expect(pending.has(token)).toBe(true);
    vi.advanceTimersByTime(1);

    expect(pending.has(token)).toBe(false);
    expect(call.settleOutstanding).toHaveBeenCalledOnce();
    expect(call.abort.signal.aborted).toBe(true);
  });

  it('keeps a taken call alive and parks nothing once stopped', () => {
    vi.useFakeTimers();
    const pending = new McpPendingCalls(1000);
    const taken = parkedCall();
    const token = pending.park(taken)!;
    expect(pending.take(token)).toBe(taken);
    expect(pending.take(token)).toBeUndefined();
    vi.advanceTimersByTime(5000);
    expect(taken.abort.signal.aborted).toBe(false);

    const left = parkedCall();
    pending.park(left);
    pending.abortAll();
    expect(left.settleOutstanding).toHaveBeenCalledOnce();
    expect(left.abort.signal.aborted).toBe(true);
    expect(pending.park(parkedCall())).toBeUndefined();
  });
});
