/**
 * Background task / scheduled wake — framework functional test (TEST-004, FLOW-002/003).
 *
 * A background-task completion or a scheduled fire re-enters the agent loop as a non-user
 * `agent-wakeup` turn. This drives that path through the REAL session (scripted provider, no CLI):
 * the wake produces an actual provider request and surfaces `turn_source: 'agent-wakeup'`, and
 * repeated wakes for the same task id coalesce.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

const TEST_TIMEOUT = 20_000;

let h: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await h?.dispose();
  h = undefined;
});

describe('background / scheduled wake (framework functional)', () => {
  it(
    'a wake injects an agent-wakeup turn that reaches the provider',
    async () => {
      h = scriptedSession({ turns: [{ text: 'user-turn' }, { text: 'wake-turn' }] });

      await h.submit('hello');
      expect(h.requests).toHaveLength(1);

      await h.wake('a background task finished — follow up', 'task-1');

      // The wake re-entered the loop: a second real provider request was made, tagged agent-wakeup.
      expect(h.requests).toHaveLength(2);
      const turnSources = h.emittedEvents('turn_source').map(([source]) => source);
      expect(turnSources).toContain('user');
      expect(turnSources).toContain('agent-wakeup');
    },
    TEST_TIMEOUT,
  );

  it(
    'repeated wakes for the same task id while one is in flight coalesce to a single turn',
    async () => {
      h = scriptedSession({ turns: [{ text: 'user-turn' }, { text: 'wake-turn' }] });
      await h.submit('hello');

      // Two wakes for the same task id: the second is dropped (coalesced) while the first is queued.
      const settled = h.wake('first wake', 'task-dup');
      h.session.requestWakeup('second wake (same task)', 'task-dup');
      await settled;

      // Only one extra provider request beyond the user turn.
      expect(h.requests).toHaveLength(2);
    },
    TEST_TIMEOUT,
  );
});
