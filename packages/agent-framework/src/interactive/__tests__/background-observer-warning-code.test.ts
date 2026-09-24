import { BackgroundTaskManager } from '@robota-sdk/agent-executor';
import { describe, expect, it, vi } from 'vitest';

import { SessionBackgroundTaskTracker } from '../interactive-session-background-tracker.js';

describe('interactive background job observer warnings', () => {
  it('passes the host warning code to the lazily created group orchestrator', () => {
    const spy = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      const manager = new BackgroundTaskManager({ runners: [] });
      const tracker = new SessionBackgroundTaskTracker(
        () => manager,
        () => {},
        () => {},
        () => {},
        () => {},
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        'ACME_BACKGROUND_OBSERVER_FAILURE',
      );
      const orchestrator = tracker.getOrchestratorOrThrow('session');
      orchestrator.subscribe(() => { throw new Error('broken'); });
      orchestrator.createGroup({ parentSessionId: 'session', waitPolicy: 'manual', taskIds: [] });
      expect(spy.mock.calls[0]?.[1]).toEqual({ code: 'ACME_BACKGROUND_OBSERVER_FAILURE' });
      tracker.dispose();
    } finally {
      spy.mockRestore();
    }
  });
});
