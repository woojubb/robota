/** Run from agent-framework: pnpm exec tsx examples/verify-goal-cassette-replay.mts */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { scriptedSession } from '@robota-sdk/agent-framework/testing';

import {
  buildGoalObjective,
  GOAL_CASSETTE_PATH,
  GOAL_MAX_ITERATIONS,
} from '../src/testing/__fixtures__/goal-cassette-fixture.js';

const cassetteBefore = readFileSync(GOAL_CASSETTE_PATH);
const harness = scriptedSession({ cassette: GOAL_CASSETTE_PATH, bare: true });
try {
  const goal = await harness.runGoal(buildGoalObjective(harness.cwd), {
    maxIterations: GOAL_MAX_ITERATIONS,
  });
  const goalFile = harness.exists('GOAL.txt') ? harness.readFile('GOAL.txt') : undefined;
  const toolNames = harness.toolCalls().map((call) => call.name);
  console.log(`status: ${goal.status}`);
  console.log(`stopReason: ${goal.stopReason}`);
  console.log(`GOAL.txt: ${goalFile ?? '(not created)'}`);
  console.log(`tool calls: ${toolNames.join(', ')}`);
  assert.equal(goal.status, 'satisfied');
  assert.equal(goal.stopReason, 'satisfied');
  assert.ok(goalFile?.includes('done'), 'GOAL.txt must contain done');
  assert.ok(toolNames.includes('Bash'), 'Bash must actually execute');
  assert.ok(toolNames.includes('report_goal_status'), 'report_goal_status must actually execute');
} finally {
  try {
    await harness.dispose();
  } finally {
    assert.deepEqual(readFileSync(GOAL_CASSETTE_PATH), cassetteBefore, 'cassette bytes changed');
  }
}
