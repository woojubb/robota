/**
 * Functional test of the goal loop against a committed goal cassette.
 *
 * On POSIX the cassette is the recording of an actual Qwen run of the goal loop — real prompts, the
 * model's real decision to use Bash and call `report_goal_status` — replayed deterministically, with
 * no key and no network. That proves the part scripted tests cannot: that a real model drives the goal
 * feature to completion. Re-record with packages/agent-framework/scripts/record-goal-cassette.mts.
 *
 * On Windows the cassette is translated from that recording, not recorded: its Bash command is the
 * PowerShell equivalent (see its `provenance`), so there the run proves the goal flow on the host
 * shell, not a model's decision.
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

describe('goal against a committed cassette for the host shell', () => {
  it(
    'the replayed run drives the goal to satisfied: it wrote the file and signalled completion',
    async () => {
      h = scriptedSession({ cassette: GOAL_CASSETTE_PATH });

      const goal = await h.runGoal(buildGoalObjective(h.cwd), {
        maxIterations: GOAL_MAX_ITERATIONS,
      });

      // The replayed run reached satisfaction...
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
