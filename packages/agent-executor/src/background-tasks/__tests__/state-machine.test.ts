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
});
