/**
 * ERR-001 G2/G3 — TUI error-state reducer: last-error message lifecycle and the
 * dead-air stall hint timer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TuiStateManager } from '../tui-state-manager';

describe('TuiStateManager — error state (ERR-001 G2)', () => {
  it('records the error message on onError and clears it when the next turn starts', () => {
    const manager = new TuiStateManager();

    manager.onError(new Error('connection reset'));
    expect(manager.lastErrorMessage).toBe('connection reset');
    expect(manager.isThinking).toBe(false);

    manager.onThinking(true);
    expect(manager.lastErrorMessage).toBeNull();
  });

  it('falls back to a generic message when no Error object arrives', () => {
    const manager = new TuiStateManager();
    manager.onError();
    expect(manager.lastErrorMessage).toBe('Unknown error');
  });
});

describe('TuiStateManager — dead-air stall hint (ERR-001 G3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flags isStalled after 15s of thinking with no provider activity', () => {
    const manager = new TuiStateManager();
    manager.onThinking(true);
    expect(manager.isStalled).toBe(false);

    vi.advanceTimersByTime(15_000);
    expect(manager.isStalled).toBe(true);
  });

  it('provider activity (text delta) resets the timer — no stall flag', () => {
    const manager = new TuiStateManager();
    manager.onThinking(true);

    vi.advanceTimersByTime(10_000);
    manager.onTextDelta('still alive');
    vi.advanceTimersByTime(10_000);
    expect(manager.isStalled).toBe(false);

    vi.advanceTimersByTime(5_000);
    expect(manager.isStalled).toBe(true);
  });

  it('clears the stall flag and timer when the turn ends (thinking false / error)', () => {
    const manager = new TuiStateManager();
    manager.onThinking(true);
    vi.advanceTimersByTime(15_000);
    expect(manager.isStalled).toBe(true);

    manager.onThinking(false);
    expect(manager.isStalled).toBe(false);

    manager.onThinking(true);
    manager.onError(new Error('boom'));
    vi.advanceTimersByTime(20_000);
    expect(manager.isStalled).toBe(false);
  });
});

describe('TuiStateManager — stall hint suppressed during tool execution (RUNTIME-39)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const runningTool = { toolName: 'bash', firstArg: 'sleep 60', isRunning: true };
  const endedTool = {
    toolName: 'bash',
    firstArg: 'sleep 60',
    isRunning: false,
    result: 'success' as const,
  };

  it('a running tool suppresses the dead-air hint — no stall while a tool executes', () => {
    const manager = new TuiStateManager();
    manager.onThinking(true); // arms the stall timer
    vi.advanceTimersByTime(10_000);
    manager.onToolStart(runningTool); // a tool is now legitimately busy → suppress
    vi.advanceTimersByTime(60_000); // long tool, no provider deltas
    expect(manager.isStalled).toBe(false);
  });

  it('re-arms the hint when the last running tool ends and the turn is still thinking', () => {
    const manager = new TuiStateManager();
    manager.onThinking(true);
    manager.onToolStart(runningTool);
    vi.advanceTimersByTime(60_000);
    expect(manager.isStalled).toBe(false);

    manager.onToolEnd(endedTool); // no more running tools → re-arm dead-air watch
    vi.advanceTimersByTime(15_000);
    expect(manager.isStalled).toBe(true);
  });

  it('does not re-arm after tool end once the turn is no longer thinking', () => {
    const manager = new TuiStateManager();
    manager.onThinking(true);
    manager.onToolStart(runningTool);
    manager.onThinking(false); // turn ended
    manager.onToolEnd(endedTool);
    vi.advanceTimersByTime(20_000);
    expect(manager.isStalled).toBe(false);
  });

  it('keeps the hint suppressed while ANY tool is still running (concurrent tools)', () => {
    const manager = new TuiStateManager();
    manager.onThinking(true);
    manager.onToolStart({ toolName: 'bash', firstArg: 'a', isRunning: true });
    manager.onToolStart({ toolName: 'bash', firstArg: 'b', isRunning: true });
    // End one of the two — one tool is still running, so the hint stays suppressed.
    manager.onToolEnd({ toolName: 'bash', firstArg: 'b', isRunning: false, result: 'success' });
    vi.advanceTimersByTime(60_000);
    expect(manager.isStalled).toBe(false);
  });
});

describe('TuiStateManager — dispose (RUNTIME-52)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the stall timer and nulls onChange so nothing fires after dispose', () => {
    const manager = new TuiStateManager();
    const onChange = vi.fn();
    manager.onChange = onChange;
    manager.onThinking(true); // arms the stall timer
    onChange.mockClear();

    manager.dispose();
    vi.advanceTimersByTime(30_000);

    expect(manager.isStalled).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('flushes the pending streaming-debounce timer on dispose', () => {
    const manager = new TuiStateManager();
    const onChange = vi.fn();
    manager.onChange = onChange;
    manager.isThinking = true;
    manager.onTextDelta('partial'); // schedules the debounced notify
    onChange.mockClear();

    manager.dispose();
    vi.advanceTimersByTime(1_000);

    expect(onChange).not.toHaveBeenCalled();
  });
});
