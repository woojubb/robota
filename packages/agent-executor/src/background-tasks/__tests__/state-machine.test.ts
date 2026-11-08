import { describe, expect, it } from 'vitest';
import {
  getBackgroundTaskTransitions,
  isTerminalBackgroundTaskStatus,
  transitionBackgroundTaskStatus,
} from '../state-machine.js';

describe('background task state machine', () => {
  it('applies every allowed transition from the transition table', () => {
    for (const transition of getBackgroundTaskTransitions()) {
      expect(transitionBackgroundTaskStatus(transition.from, transition.event)).toBe(transition.to);
    }
  });

  it('rejects unsupported transitions with a typed validation error', () => {
    expect(() => transitionBackgroundTaskStatus('queued', 'COMPLETE')).toThrow(
      'Invalid background task transition',
    );
  });

  it('treats terminal states as immutable for lifecycle events', () => {
    expect(isTerminalBackgroundTaskStatus('completed')).toBe(true);
    expect(isTerminalBackgroundTaskStatus('failed')).toBe(true);
    expect(isTerminalBackgroundTaskStatus('cancelled')).toBe(true);

    expect(() => transitionBackgroundTaskStatus('completed', 'START')).toThrow('terminal status');
  });

  // SELFHOST-012 TC-01: non-destructive pause/resume lifecycle for scheduled tasks.
  it('supports non-destructive pause/resume and keeps `paused` non-terminal', () => {
    expect(transitionBackgroundTaskStatus('sleeping', 'PAUSE')).toBe('paused');
    expect(transitionBackgroundTaskStatus('running', 'PAUSE')).toBe('paused');
    expect(transitionBackgroundTaskStatus('paused', 'RESUME')).toBe('sleeping');
    // a paused schedule can still be destroyed, but `paused` itself is not terminal
    expect(transitionBackgroundTaskStatus('paused', 'CANCEL')).toBe('cancelled');
    expect(isTerminalBackgroundTaskStatus('paused')).toBe(false);
  });

  it('rejects illegal pause/resume edges', () => {
    expect(() => transitionBackgroundTaskStatus('paused', 'PAUSE')).toThrow(
      'Invalid background task transition',
    );
    expect(() => transitionBackgroundTaskStatus('sleeping', 'RESUME')).toThrow(
      'Invalid background task transition',
    );
    expect(() => transitionBackgroundTaskStatus('completed', 'PAUSE')).toThrow('terminal status');
  });
});
