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
