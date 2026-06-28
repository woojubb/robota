/**
 * GOAL-001 functional test at the FRAMEWORK level (TEST-003 reference).
 *
 * Drives the autonomous goal loop end to end through a REAL InteractiveSession + the deterministic
 * scripted provider — no CLI, no live LLM. This is the canonical example of verifying a feature
 * with the functional harness instead of at the CLI surface.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../../testing/index.js';

const TEST_TIMEOUT = 20_000;

let harness: ScriptedSessionHarness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe('GOAL-001 autonomous goal (framework functional)', () => {
  it(
    'pursues the objective across turns: writes a file, then signals satisfied → exit reason satisfied',
    async () => {
      harness = scriptedSession({
        turns: [
          // iteration 1: do real work, then report "continue"
          {
            toolCalls: [{ name: 'Bash', args: { command: 'echo 2026-06-27 > {{cwd}}/GOAL.txt' } }],
          },
          {
            toolCalls: [
              { name: 'report_goal_status', args: { status: 'continue', reason: 'file written' } },
            ],
          },
          { text: 'made progress' },
          // iteration 2: report "satisfied" → loop stops
          {
            toolCalls: [
              {
                name: 'report_goal_status',
                args: { status: 'satisfied', reason: 'GOAL.txt exists' },
              },
            ],
          },
          { text: 'goal complete' },
        ],
      });

      const goal = await harness.runGoal('create GOAL.txt containing the date, then stop');

      expect(goal.status).toBe('satisfied');
      expect(goal.stopReason).toBe('satisfied');
      expect(harness.exists('GOAL.txt')).toBe(true);
      expect(harness.readFile('GOAL.txt').trim()).toBe('2026-06-27');
      // The loop ran more than one autonomous turn.
      expect(goal.iterations).toBeGreaterThanOrEqual(2);
    },
    TEST_TIMEOUT,
  );

  it(
    'stops at the iteration bound when the agent never signals satisfied',
    async () => {
      // Each iteration does real work (no-progress guard never trips) but only ever "continue".
      const iteration = () => [
        { toolCalls: [{ name: 'Bash', args: { command: 'echo step >> {{cwd}}/log.txt' } }] },
        {
          toolCalls: [
            { name: 'report_goal_status', args: { status: 'continue', reason: 'more to do' } },
          ],
        },
        { text: 'iterating' },
      ];
      harness = scriptedSession({
        turns: [...iteration(), ...iteration(), ...iteration(), ...iteration()],
      });

      const goal = await harness.runGoal('an unbounded objective', { maxIterations: 2 });

      expect(goal.status).toBe('stopped');
      expect(goal.stopReason).toBe('max-iterations');
      expect(goal.iterations).toBe(2);
    },
    TEST_TIMEOUT,
  );
});
