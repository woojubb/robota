/**
 * GOAL-001 functional test against a REAL recorded model run (TEST-005).
 *
 * Replays a committed cassette of an actual Qwen run of the goal loop — real prompts, the model's
 * real decision to use Bash and call `report_goal_status` — deterministically, with no key and no
 * network. This proves the part scripted tests cannot: that a real model actually drives the goal
 * feature to completion. Re-record with packages/agent-cli/scripts/record-goal-cassette.mts.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';
import {
  GOAL_CASSETTE_PATH,
  GOAL_MAX_ITERATIONS,
  buildGoalObjective,
} from '../__fixtures__/goal-cassette-fixture.js';

const TEST_TIMEOUT = 20_000;

let h: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await h?.dispose();
  h = undefined;
});

describe('GOAL-001 against a real recorded model (cassette)', () => {
  it(
    'a real Qwen run drives the goal to satisfied: it wrote the file and signalled completion',
    async () => {
      h = scriptedSession({ cassette: GOAL_CASSETTE_PATH });

      const goal = await h.runGoal(buildGoalObjective(h.cwd), {
        maxIterations: GOAL_MAX_ITERATIONS,
      });

      // The recorded real model reached satisfaction...
      expect(goal.status).toBe('satisfied');
      expect(goal.stopReason).toBe('satisfied');
      // ...by actually creating the file...
      expect(h.exists('GOAL.txt')).toBe(true);
      expect(h.readFile('GOAL.txt')).toContain('done');
      // ...and using the real tools, including the structured completion signal.
      const toolNames = h.toolCalls().map((call) => call.name);
      expect(toolNames).toContain('Bash');
      expect(toolNames).toContain('report_goal_status');
    },
    TEST_TIMEOUT,
  );
});
